import fs from "node:fs";
import Path from "node:path";
import Handlebars from "handlebars";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import node_modules from "node_modules-path";
import * as Helpers from "./helpers.js"

const maxApiDefinitionLocation = Path.resolve(
  node_modules("@types/max-api"),
  "@types/max-api/index.d.ts"
);
// Load our max api types
const source = fs.readFileSync(maxApiDefinitionLocation, "utf-8");

// Use babel to get out an AST tree of the type description
// In theory you could also do this with pure TS but this is
// marginally easier to work with when you only look at dts
const ast = parse(source, {
  plugins: [["typescript", { dts: true }]],
  sourceType: "module",
});

// We have to manually parse the AST into something we can template out
// because this is NOT a source file it's only a definition so we can't
// transform it directly into code
let filteredTemplateData = { enums: [], funcs: [], types: [] };

// We use this in ast traversal/recursion to make a new element we can add data to
function newElement(type, name) {
  return { name: name, type: type, subParams: [] };
}

// We need to know if we are traversing the AST recursively, so we use these helpers
let recursing = 0;
function recursiveTraversal(path, handler, context) {
  const { scope, node } = path;
  recursing += 1;
  scope.traverse(node, handler, context);
  recursing -= 1;
}
function isRecursing() {
  return recursing > 0;
}

// Handlers for the different types we extract from the AST

const enumValueHandler = {
  TSEnumMember(path) {
    let value = {
      key: path.node.id.name,
      value: path.node.initializer.value,
      comment: joinComments(path.node.leadingComments),
    };
    this.push(value);
  },
};

//Called inside the function handler
const typeHandler = {
  TSTypeReference(path) {
    //An Array<> !== TSArrayType!!!!
    if (
      path.node.typeName.name === "Array" ||
      path.node.typeName.name === "Record"
    ) {
      let subparam = this;
      if (!isRecursing()) {
        this.type = path.node.typeName.name;
      }
      if (path.node.typeName.name === "Array" && isRecursing()) {
        let sp = newElement(path.node.typeName.name);
        this.subParams.push(sp);
        subparam = sp;
      }
      recursiveTraversal(path, typeHandler, subparam);
      path.skip();
    } else {
      this.subParams.push(newElement(path.node.typeName.name));
    }
  },
  TSStringKeyword(path) {
    this.subParams.push(newElement(path.node.type));
  },
  TSBooleanKeyword(path) {
    this.subParams.push(newElement(path.node.type));
  },
  TSNullKeyword(path) {
    this.subParams.push(newElement(path.node.type));
  },
  TSAnyKeyword(path) {
    if (path.key !== "typeAnnotation")
      this.subParams.push(newElement(path.node.type));
  },
  TSNumberKeyword(path) {
    this.subParams.push(newElement(path.node.type));
  },
  TSUnionType(path) {
    let subparam = this;
    if (!isRecursing()) {
      this.type = path.node.type;
    } else {
      let sp = newElement(path.node.type);
      this.subParams.push(sp);
      subparam = sp;
    }
    recursiveTraversal(path, typeHandler, subparam);
    path.skip();
  },
  TSArrayType(path) {
    let subparam = this;
    if (isRecursing()) {
      subparam = newElement(path.node.type);
      this.subParams.push(subparam);
    } else {
      this.type = path.node.type;
    }
    recursiveTraversal(path, typeHandler, subparam);
    path.skip();
  },
  TSFunctionType(path) {
    let subparam = this;
    if (isRecursing()) {
      subparam = newElement(path.node.type);
      this.subParams.push(subparam);
    } else {
      this.type = path.node.type;
    }
    recursiveTraversal(path, typeHandler, subparam);
    //Skip because we don't want to process the subtree this again
    path.skip();
  },
};

const functionValueHandler = {
  TSTypeAnnotation(path) {
    if (path.key == "returnType") {
      const { scope, node } = path;
      const returnTypeHandler = {
        Identifier(path) {
          this.returnType.push(path.node.name);
        },
        TSTypeAnnotation(path) {
          this.returnType.push(path.node.type);
        },
        TSVoidKeyword(path) {
          this.returnType.push(path.type);
        },
      };
      scope.traverse(node, returnTypeHandler, this);
    }
  },
  RestElement(path) {
    if (path.listKey === "params") {
      let param = { name: path.node.argument.name, type: "", subParams: [] };
      const { scope, node } = path;
      scope.traverse(node, typeHandler, param);
      this.params.push(param);
      return;
    }
  },
  Identifier(path) {
    if (path.key === "id") {
      this.id = path.node.name;
      return;
    }
    if (path.listKey === "params") {
      let param = { name: path.node.name, type: "", subParams: [] };
      const { scope, node } = path;
      scope.traverse(node, typeHandler, param);
      this.params.push(param);
      return;
    }
  },
};

const ModuleHandler = {
  TSEnumDeclaration(path) {
    let leadingComment = joinComments(path.node.leadingComments);
    let enumData = {
      id: path.node.id.name,
      leadingComment: leadingComment,
      values: [],
    };
    path.traverse(enumValueHandler, enumData.values);
    filteredTemplateData.enums.push(enumData);
  },
  TSTypeAliasDeclaration(path) {
    let typeData = newElement("", path.node.id.name);
    path.traverse(typeHandler, typeData);
    filteredTemplateData.types.push(typeData);
  },
  TSDeclareFunction(path) {
    let funcData = {
      id: "",
      comment: joinComments(path.node.leadingComments),
      params: [],
      returnType: [],
    };
    path.traverse(functionValueHandler, funcData);
    filteredTemplateData.funcs.push(funcData);
  },
};

//Traverse the ast, using the functions above to walk the path and extract the data we need
traverse.default(ast, {
  TSModuleDeclaration(path) {
    // Only traverse things inside the module, since types outside of that
    // are unexported helpers we don't need to care about
    const { scope, node } = path;
    scope.traverse(node, ModuleHandler);
  },
});

function joinComments(commentArray) {
  let comment = "";
  commentArray.forEach((lc) => {
    comment += lc.value + " ";
  });
  return comment;
}

console.log("Finished Traversal");

// Load Template Partials
var partialsDir = node_modules()+'/../src/templates/partials';
var filenames = fs.readdirSync(partialsDir);
filenames.forEach(function (filename) {
  var matches = /^([^.]+).hbs$/.exec(filename);
  if (!matches) {
    return;
  }
  var name = matches[1];
  var template = fs.readFileSync(partialsDir + '/' + filename, 'utf8');
  Handlebars.registerPartial(name, template);
});

//Template Helpers
Handlebars.registerHelper("typeRenderer", Helpers.typeRender);
Handlebars.registerHelper("TypeConverter", Helpers.typeConverter);
Handlebars.registerHelper("returnPromise", Helpers.returnPromise);
Handlebars.registerHelper("CommentBuilder", Helpers.commentBuilder);
Handlebars.registerHelper("ReturnTypeConverter", Helpers.returnTypeConverter);

//Testing helpers
Handlebars.registerHelper("returnPromiseTest", Helpers.returnPromiseTest);
Handlebars.registerHelper("returnTypeTest", Helpers.returnTypeTest);
Handlebars.registerHelper("isPostFunction", Helpers.isPostFunction);
Handlebars.registerHelper("testParamResolver", Helpers.testParamResolver);

//Now we need to actually do the rendering
const template = Handlebars.compile(fs.readFileSync(node_modules()+"/../src/templates/index.hbs", "utf8"));

const render = template(filteredTemplateData);
try {
  fs.writeFileSync("./index.js", render);
} catch (err) {
  console.error(err);
}

console.log("generated index.js");

const tests = Handlebars.compile(fs.readFileSync(node_modules()+"/../src/templates/index.test.hbs", "utf8"));
const rendertests = tests(filteredTemplateData);
try {
  fs.writeFileSync("./index.test.js", rendertests);
} catch (err) {
  console.error(err);
}
console.log("generated index.test.js");