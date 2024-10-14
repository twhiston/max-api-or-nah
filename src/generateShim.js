import fs from "fs";
import Handlebars from "handlebars";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { enumStringMember } from "@babel/types";

// Load our max api types
const source = fs.readFileSync(
  "./node_modules/@types/max-api/index.d.ts",
  "utf-8"
);

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

const EnumValueHandler = {
  TSEnumMember(path) {
    let value = {
      key: path.node.id.name,
      value: path.node.initializer.value,
      comment: joinComments(path.node.leadingComments),
    };
    this.push(value);
  },
};

//Sometimes we have inner types, such as array types or union types
//So we need to handle these
// const innerTypeHandler = {
//   TSStringKeyword(path) {
//     this.push({type: path.node.type})
//   },
//   TSBooleanKeyword(path) {
//     this.push({type: path.node.type})
//   },
//   TSNullKeyword(path) {
//     this.push({type: path.node.type})
//   },
// }

function newSubParam(type) {
  return { type: type, subParams: [] };
}

let recursing = 0;

function recurseTraversal(path, handler, context){
  const { scope, node } = path;
  recursing += 1;
  scope.traverse(node, handler, context);
  recursing -= 1;
}
function isRecursing(){
  return (recursing > 0);
}
//Called inside the function handler
const typeHandler = {
  TSTypeReference(path) {
    //An Array<> !== TSArrayType!!!!
    if(path.node.typeName.name === "Array"){
      let subparam = this;
      if (isRecursing()) {
        let sp = newSubParam(path.node.typeName.name);
        this.push(sp);
        subparam = sp.subParams;
      } else {
        this.type = path.node.type;
      }
      recurseTraversal(path, typeHandler, subparam);
      path.skip();
    } else {
      this.push(newSubParam(path.node.typeName.name));
    }

    //if(this.type === "") this.type = path.node.typeName.name;
  },
  TSStringKeyword(path) {
    this.push(newSubParam(path.node.type));
    //if(this.type === "") this.type = path.node.type;
  },
  TSBooleanKeyword(path) {
    this.push(newSubParam(path.node.type));
    //if(this.type === "") this.type = path.node.type;
  },
  TSNullKeyword(path) {
    this.push(newSubParam(path.node.type));
    //if(this.type === "") this.type = path.node.type;
  },
  TSAnyKeyword(path) {
    if(path.key !== "typeAnnotation")
      this.push(newSubParam(path.node.type));
    //if(this.type === "") this.type = path.node.type;
  },
  TSNumberKeyword(path) {
    this.push(newSubParam(path.node.type));
  },
  TSVoidKeyword(path) {
    console.log(path);
  },
  TSTypeParameterInstantiation(path) {
    //if it's this type we know its something like Record<MaxFunctionSelector, MaxFunctionHandler>
    // in this situation we need to traverse the tree specifically and scope out what we need
    // if (Array.isArray(this)) {
    //   this.push(newSubParam(path.node.type));
    // } else {
    //   let subP = [];
    //   const { scope, node } = path;
    //   scope.traverse(node, paramHandler, subP);
    //   this.subParams = subP;
    // }
  },
  TSUnionType(path) {
    this.type = path.node.type;
    let subparam = this;
    if(!isRecursing()){
      subparam = this.subParams;
    }
    recurseTraversal(path, typeHandler, subparam);
    //Skip because we don't want to process the subtree this again
    path.skip();
  },
  TSArrayType(path) {
    let subparam = this.subParams;
    if (isRecursing()) {
      let subparam = newSubParam(path.node.type);
      this.subParams.push(subparam);
      subparam = subparam.subParams;
    } else {
      this.type = path.node.type;
    }
    recurseTraversal(path, typeHandler, subparam);
    //Skip because we don't want to process the subtree this again
    path.skip(); // if checking the children is irrelevant
  },
  TSTypeAnnotation(path) {
    //path.skip();
    //We do this because we want to ignore return types, which fall under type annotations
    //and apparently have no other signifier, in a type alias for a function type, eg MaxFunctionHandler
  },
};

const GetFunctionValues = {
  TSTypeAnnotation(path) {
    if (path.key == "returnType") {
      const { scope, node } = path;
      const returnTypeHandler = {
        Identifier(path) {
          this.funcData.returnType.push(path.node.name);
        },
        TSTypeAnnotation(path) {
          this.funcData.returnType.push(path.node.type);
        },
        TSVoidKeyword(path) {
          this.funcData.returnType.push(path.type);
        },
      };
      scope.traverse(node, returnTypeHandler, this);
    }
  },
  Identifier(path) {
    if (path.key === "id") {
      this.funcData.id = path.node.name;
      return;
    }
    //A param is a custom type of value
    if (path.listKey === "params") {
      let param = { name: path.node.name, type: "", subParams: [] };
      const { scope, node } = path;
      scope.traverse(node, typeHandler, param);
      this.funcData.params.push(param);
      return;
    }
    // //An argument is like ...args
    if (path.key === "argument") {
      let param = { name: path.node.name, type: "", subParams: [] };
      const { scope, node } = path;
      scope.traverse(node, typeHandler, param);
      this.funcData.params.push(param);
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
    path.traverse(EnumValueHandler, enumData.values);
    filteredTemplateData.enums.push(enumData);
  },
  TSTypeAliasDeclaration(path) {
    //let typeData = { name: path.node.id.name, type: path.node.typeAnnotation.type, subParams: [] };
    let typeData = { name: path.node.id.name, type: "", subParams: [] };
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
    path.traverse(GetFunctionValues, { funcData });
    filteredTemplateData.funcs.push(funcData);
  },
};

//Traverse the ast, using the functions above to walk the path and extract the data we need
traverse.default(ast, {
  enter(path) {
    if (t.isTSModuleDeclaration(path.node)) {
      // Only traverse things inside the module, since types outside of that
      // are unexported helpers we don't need to care about
      const { scope, node } = path;
      scope.traverse(node, ModuleHandler);
    }
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

//Handle our filtered enum data as a partial
Handlebars.registerPartial(
  "enum",
  `
    /*{{#TsTypeCommentConverter enum.leadingComment}}{{/TsTypeCommentConverter}} */
    {{enum.id}}: {
    {{#each enum.values}}
        {{this.key}}: '{{this.value}}',
    {{/each}}
    },
    `
);
//Render a function definition
Handlebars.registerPartial(
  "func",
  `
/*{{#TsTypeCommentConverter func.comment}}{{/TsTypeCommentConverter}} */
{{func.id}}: ({{#each func.params}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}) => {{#returnPromise func.returnType}}{{#TsTypeReturnConverter func.returnTypeParameters}}{{/TsTypeReturnConverter}}{{/returnPromise}},
    `
);

//TODO rejig this into a general parser for the return type array
Handlebars.registerHelper("returnPromise", function (context, options) {
  switch (context) {
    case "Promise":
      return new Handlebars.SafeString(
        "Promise.resolve(" + options.fn(this) + ")"
      );
      break;
    default:
      return new Handlebars.SafeString("{" + options.fn(this) + "}");
      break;
  }
});

Handlebars.registerHelper(
  "TsTypeCommentConverter",
  function (context, options) {
    const findArray = ["TSArrayType", "TSStringKeyword"];
    const replaceArray = ["array", "string"];
    return new Handlebars.SafeString(
      replaceBulk(context, findArray, replaceArray)
    );
  }
);

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

Handlebars.registerHelper("TsTypeReturnConverter", function (context, options) {
  let output = "";
  context.some((rtp) => {
    rtp.some((rtpp) => {
      console.log(rtpp);
      switch (rtpp) {
        case "TSVoidKeyword":
          return true;
        case "TSNullKeyword":
          output = new Handlebars.SafeString("null");
          break;
        case "JSONObject":
          output = new Handlebars.SafeString("{}");
          break;
        //TODO: fix type references here
        default:
          break;
      }
      return output != "";
    });
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
