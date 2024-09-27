import fs from "fs";
import Handlebars from "handlebars";
import { parse } from "@babel/parser";

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
ast.program.body.forEach((element) => {
  if (element.type == "TSModuleDeclaration") {
    element.body.body.forEach((inner) => {
      if (inner.type == "TSEnumDeclaration") {
        let leadingComment = inner.leadingComments[0].value;
        let enumdata = {
          id: inner.id.name,
          leadingComment: leadingComment,
          values: [],
        };
        inner.members.forEach((im) => {
          let value = { id: im.id.name, value: im.initializer.value };
          let comment = "";
          im.leadingComments.forEach((lc) => {
            comment += lc.value + " ";
          });
          value.comment = comment;

          enumdata.values.push({
            key: im.id.name,
            value: im.initializer.value,
          });
        });
        filteredTemplateData.enums.push(enumdata);
      }
      if (inner.type == "TSDeclareFunction") {
        let funcdata = { id: inner.id.name };
        let returnType = has(inner.returnType.typeAnnotation, "typeName")
          ? inner.returnType.typeAnnotation.typeName.name
          : inner.returnType.typeAnnotation.type;
        funcdata.returnType = returnType;
        let rtp = [];
        if (has(inner.returnType.typeAnnotation, "typeParameters")) {
          inner.returnType.typeAnnotation.typeParameters.params.forEach(
            (element) => {
              let subt = [];
              if (element.type == "TSUnionType") {
                element.types.forEach((st) => {
                    if(st.type === "TSTypeReference"){
                        subt.push(st.typeName.name);
                    } else {
                        subt.push(st.type);
                    }
                });
              } else {
                if(element.type === "TSTypeReference"){
                    subt.push(element.typeName.name);
                } else {
                    subt.push(element.type);
                }
              }
              rtp.push(subt);
            }
          );
        }
        funcdata.returnTypeParameters = rtp;
        let comment = "";
        inner.leadingComments.forEach((lc) => {
          comment += lc.value + " ";
        });

        let params = [];
        inner.params.forEach((param) => {
          let typename = "";
          typename = has(param.typeAnnotation.typeAnnotation, "typeName")
            ? param.typeAnnotation.typeAnnotation.typeName.name
            : param.typeAnnotation.typeAnnotation.type;
          let pname = has(param, "name")
            ? param.name
            : "..." + param.argument.name;
          comment += pname + " typeof " + typename + ", ";
          params.push({ name: pname });
        });
        funcdata.comment = comment;
        funcdata.params = params;
        filteredTemplateData.funcs.push(funcdata);
      }
    });
  }
});

function has(object, key) {
  return object ? hasOwnProperty.call(object, key) : false;
}

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

//addHandler: () => {},
Handlebars.registerPartial(
  "func",
  `
/*{{#TsTypeCommentConverter func.comment}}{{/TsTypeCommentConverter}} */
{{func.id}}: ({{#each func.params}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}) => {{#returnPromise func.returnType}}{{#TsTypeReturnConverter func.returnTypeParameters}}{{/TsTypeReturnConverter}}{{/returnPromise}},
    `
);

Handlebars.registerHelper("returnPromise", function (context, options) {
    switch (context) {
        case "Promise":
            return new Handlebars.SafeString("Promise.resolve("+ options.fn(this) +")")
            break;
        default:
            return new Handlebars.SafeString("{"+options.fn(this)+"}");
            break;
    }
});

Handlebars.registerHelper("TsTypeCommentConverter", function (context, options){
    const findArray = ["TSArrayType", "TSStringKeyword"]
    const replaceArray = ["array", "string"]
    return new Handlebars.SafeString(replaceBulk(context, findArray, replaceArray))
})

//https://stackoverflow.com/questions/5069464/replace-multiple-strings-at-once
function replaceBulk( str, findArray, replaceArray ){
    var i, regex = [], map = {};
    for( i=0; i<findArray.length; i++ ){
      regex.push( findArray[i].replace(/([-[\]{}()*+?.\\^$|#,])/g,'\\$1') );
      map[findArray[i]] = replaceArray[i];
    }
    regex = regex.join('|');
    str = str.replace( new RegExp( regex, 'g' ), function(matched){
      return map[matched];
    });
    return str;
  }

Handlebars.registerHelper("TsTypeReturnConverter", function (context, options){
    let output = "";
    context.some(rtp => {
        rtp.some(rtpp => {
        console.log(rtpp)
        switch (rtpp) {
            case 'TSVoidKeyword':
                return true;
            case "TSNullKeyword":
                output = new Handlebars.SafeString("null");
                break;
            case "JSONObject":
                output = new Handlebars.SafeString("{}")
                break;
            //TODO: fix type references here
            default:
                break;
        }
        return output != "";
    })
    return output != "";
    });
    return output;
})

//Now we need to actually do the rendering
const template = Handlebars.compile(
  fs.readFileSync("./src/shim.hbs", "utf8")
);

const render = template(filteredTemplateData);
try {
  fs.writeFileSync("./generatedIndex.js", render);
  // file written successfully
} catch (err) {
  console.error(err);
}
console.log(render);
