import fs from "fs";
import Path from "path";
import Handlebars from "handlebars";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import node_modules from "node_modules-path";

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

// // type {{type.name}} = {{#each type.subParams}} {{this.type}} {{#unless @last}} | {{/unless}} {{/each}}
Handlebars.registerPartial(
  "type",
  `
//type {{type.name}} = {{#typeRenderer (TypeConverter type.subParams) type}} {{/typeRenderer}}`
);
Handlebars.registerHelper("typeRenderer", function (types, typedef) {
  return new Handlebars.SafeString(typeRenderer(types, typedef));
});

function typeRenderer(types, typedef) {
  switch (typedef.type) {
    case "TSUnionType":
      let union = [];
      types.forEach((element) => {
        union.push(typeRenderer(types, element));
      });
      return union
        .map(function (elem) {
          return elem;
        })
        .join(" | ");
    case "Array":
      let arr = "Array<";
      typedef.subParams.forEach((element) => {
        arr += typeRenderer(element.subParams, element);
      });
      arr += ">";
      return arr;
    case "TSFunctionType":
      let output = "(...args: ";
      typedef.subParams.forEach((element) => {
        switch (element.type) {
          case "TSArrayType":
            element.subParams.forEach((inner) => {
              switch (inner.type) {
                case "TSAnyKeyword":
                  output += "any";
                  break;
                default:
                  throw new Error(
                    "type helper " +
                      inner.type +
                      " unknown! Please create github issue"
                  );
              }
              output += "[]";
            });
            break;
          default:
            throw new Error(
              "type helper " +
                element.type +
                " unknown! Please create github issue"
            );
        }
      });
      output += ")";
      return output;

    default:
      return typedef.type;
  }
}

//Handle our filtered enum data as a partial
Handlebars.registerPartial(
  "enum",
  `
/*{{enum.leadingComment}}*/
{{enum.id}}: {
{{#each enum.values}}
  {{this.key}}: '{{this.value}}',
{{/each}}
},`
);
//Render a function definition
Handlebars.registerPartial(
  "func",
  `
/*
{{#CommentBuilder func}}{{/CommentBuilder}}
*/
{{func.id}}: ({{#each func.params}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}) => {{#returnPromise func.returnType}}{{#ReturnTypeConverter func.returnType}}{{/ReturnTypeConverter}}{{/returnPromise}},
    `
);

Handlebars.registerHelper("TypeConverter", function (context, options) {
  return typeConverter(context);
});

function typeConverter(context) {
  let output = [];
  context.forEach((element) => {
    switch (element.type) {
      case "TSStringKeyword":
        output.push({ type: "string" });
        break;
      case "TSNumberKeyword":
        output.push({ type: "number" });
        break;
      case "Array":
        let op = { type: "Array", subParams: [] };
        op.subParams = typeConverter(element.subParams);
        output.push(op);
        break;
      case "TSUnionType":
        let un = { type: element.type, subParams: [] };
        un.subParams = typeConverter(element.subParams);
        output.push(un);
        break;
      default:
        output.push({ type: element.type });
    }
  });
  return output;
}

//TODO rejig this into a general parser for the return type array
Handlebars.registerHelper("returnPromise", function (context, options) {
  switch (context[0]) {
    case "Promise":
      return new Handlebars.SafeString(
        "Promise.resolve(" + options.fn(this) + ")"
      );
    default:
      return new Handlebars.SafeString("{" + options.fn(this) + "}");
  }
});

Handlebars.registerHelper("CommentBuilder", function (context, options) {
  let comment = "* " + context.comment.split("*").pop().trim();
  if (Array.isArray(context.params) && context.params.length > 0) {
    comment += "\n* Types: ";
    comment += "\n*   " + commentParamBuilder(context.params);
  }
  const findArray = [
    "TSArrayType",
    "TSStringKeyword",
    "TSNumberKeyword",
    "TSUnionType",
  ];
  const replaceArray = ["array", "string", "number", "union"];
  return new Handlebars.SafeString(
    replaceBulk(comment, findArray, replaceArray)
  );
});

function commentParamBuilder(params) {
  let comment = "";
  params.forEach((element) => {
    if (element.name !== undefined && element.name !== "")
      comment += element.name;
    if (element.type !== "") {
      comment += " " + element.type;
      switch (element.type) {
        case "TSArrayType":
        case "Record":
        case "Array":
          comment += "<";
          let subs = element.subParams.map(function (elem) {
            return commentParamBuilder([elem]);
          });
          comment += subs.join(", ").trim();
          comment += ">";
          break;
        case "TSUnionType":
          let union = element.subParams.map(function (elem){
            return commentParamBuilder([elem]);
          })
          comment = union.join(" |").trim();
          break;
        default:
          comment += commentParamBuilder(element.subParams);
      }
    } else if (
      Array.isArray(element.subParams) &&
      element.subParams.length > 0
    ) {
      comment += commentParamBuilder(element.subParams) + "\n*   ";
    }
  });
  if(comment.endsWith("\n*   "))
    comment = comment.slice(0, -5)
  return comment;
}

//https://stackoverflow.com/questions/5069464/replace-multiple-strings-at-once
function replaceBulk(str, findArray, replaceArray) {
  var i,
    regex = [],
    map = {};
  for (i = 0; i < findArray.length; i++) {
    regex.push(findArray[i].replace(/([-[\]{}()*+?.\\^$|#,])/g, "\\$1"));
    map[findArray[i]] = replaceArray[i];
  }
  regex = regex.join("|");
  str = str.replace(new RegExp(regex, "g"), function (matched) {
    return map[matched];
  });
  return str;
}

Handlebars.registerHelper("ReturnTypeConverter", function (context, options) {
  let output = "";
  context.some((rtp) => {
    console.log(rtp);
    switch (rtp) {
      case "TSVoidKeyword":
        return true;
      case "TSNullKeyword":
        output = new Handlebars.SafeString("null");
        break;
      case "JSONObject":
        output = new Handlebars.SafeString("{}");
        break;
      default:
        // throw new Error(
        //   "Return type " + context + " unknown! Please create github issue"
        // );
        break;
    }
    return output != "";
  });
  return output;
});

//Now we need to actually do the rendering
const template = Handlebars.compile(fs.readFileSync("./src/shim.hbs", "utf8"));

const render = template(filteredTemplateData);
try {
  fs.writeFileSync("./index.js", render);
  // file written successfully
} catch (err) {
  console.error(err);
}
console.log(render);
