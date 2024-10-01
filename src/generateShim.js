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
var filteredTemplateData = { enums: [], funcs: [] };

const GetEnumValues = {
  TSEnumMember(path) {
    let value = {
      key: path.node.id.name,
      value: path.node.initializer.value,
      comment: joinComments(path.node.leadingComments),
    };
    this.enumData.values.push(value);
  },
};

//Called inside the function handler
const paramHandler = {
  TSArrayType(path){
    console.log(path);
  },
  Identifier(path) {
    //TODO does not work for base types like string
    this.type = path.node.name;
  },
  TSTypeReference(path) {
    //Type references will then go to Identifier as its the next child
    //do we need to be explicit and get it from here instead with another handler?
    console.log(path);
  },
  TSTypeParameterInstantiation(path) {
    //if it's this type we know its something like Record<MaxFunctionSelector, MaxFunctionHandler>
   // in this situation we need to traverse the tree specifically and scope out what we need
   const { scope, node } = path;
   let subP = {type: "", subParams: []}
   scope.traverse(node, paramHandler, subP);
   this.subParams.push(subP);
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
  TSArrayType(path){
    //Ideally we want to do this here, but it won't work because it's
    //at the wrong level :()
    // console.log(path)
    // const { scope, node } = path;
    // let subP = {type: "", subParams: []}
    // scope.traverse(node, paramHandler, subP);
    // this.subParams.push(subP);

      let param = { name: path.node.name, type: "", subParams: [] };
        const { scope, node } = path;
        scope.traverse(node, paramHandler, param);
        this.funcData.params.push(param);
        return;

  },
  Identifier(path) {
    if (path.key == "id") {
      this.funcData.id = path.node.name;
      return;
    }
    //A param is a custom type of value
    if (path.listKey == "params") {
    let param = { name: path.node.name, type: "", subParams: [] };
      const { scope, node } = path;
      scope.traverse(node, paramHandler, param);
      this.funcData.params.push(param);
      return;
    }
    // //An argument is like ...args
    if(path.key == 'argument') {
      let param = { name: path.node.name, type: "", subParams: [] };
      const { scope, node } = path;
      scope.traverse(node, paramHandler, param);
      this.funcData.params.push(param);
    }
  },
};

//Traverse the ast, using the functions above to walk the path and extract the data we need
traverse.default(ast, {

  enter(path) {
    if (t.isTSEnumDeclaration(path.node)) {
      let leadingComment = joinComments(path.node.leadingComments);
      let enumData = {
        id: path.node.id.name,
        leadingComment: leadingComment,
        values: [],
      };
      path.traverse(GetEnumValues, { enumData });
      filteredTemplateData.enums.push(enumData);
    }
    if (t.isTSDeclareFunction(path.node)) {
      let funcData = {
        id: "",
        comment: joinComments(path.node.leadingComments),
        params: [],
        returnType: [],
      };
      path.traverse(GetFunctionValues, { funcData });
      filteredTemplateData.funcs.push(funcData);
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
