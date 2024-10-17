import Handlebars from "handlebars";

export function typeConverter(context) {
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

export function returnPromise(context, options) {
  switch (context[0]) {
    case "Promise":
      if (this.id !== "post") {
        return new Handlebars.SafeString(
          "Promise.resolve(" + options.fn(this) + ")"
        );
      } else {
        return new Handlebars.SafeString(
          "Promise.resolve(console.log(" + this.params[0].name + "))"
        );
      }
    default:
      return new Handlebars.SafeString("{" + options.fn(this) + "}");
  }
}

export function returnPromiseTest(context, options) {
  switch (context[0]) {
    case "Promise":
      return true;
    default:
      return false;
  }
}

export function returnTypeTest(context, options) {
  switch (context[0]) {
    case "TSVoidKeyword":
      return new Handlebars.SafeString("toBe()");
    case "Promise":
      if (context[1] === "TSVoidKeyword") {
        return new Handlebars.SafeString("toBe()");
      }
      if (context[1] === "JSONObject") {
        return new Handlebars.SafeString("toMatchObject({})");
      }
    default:
      throw new Error(
        "Return type " + context[0] + " unknown! Please create github issue"
      );
  }
}

export function isPostFunction(context) {
  return context === "post";
}

export function testParamResolver(context) {
  let output = testParamBuilder(context);
  return new Handlebars.SafeString(output.join(","));
}

/*
const handlers = {
  [MESSAGE_TYPES.BANG]: () => {
    console.log("got a bang");
  },
  [MESSAGE_TYPES.NUMBER]: (num) => {
  },
  my_message: () => {
    console.log("got my_message");
  },
  my_message_with_args: (arg1, arg2) => {
    console.log("got my arged message: ${arg1}, ${arg2} ");
  }
  [MESSAGE_TYPES.ALL]: (handled, ...args) => {
    console.log("This will be called for ALL messages");
    console.log(`The following inlet event was ${!handled ? "not " : "" }handled`);
    console.log(args);
  }
};

*/
function testParamBuilder(context) {
  let output = [];
  context.forEach((element) => {
    if (element.type !== "") {
      switch (element.type) {
        case "Record":
          let rec = "{[";
          let items = testParamBuilder(element.subParams);
          rec += items.join("]:");
          rec += "}";
          output.push(rec);
          break;
        case "MaxFunctionSelector":
          output.push("Max.MESSAGE_TYPES.ALL");
          break;
        case "MaxFunctionHandler":
          output.push("(...args)=>{}");
          break;
        case "TSArrayType":
        case "Array":
          let arr = "[";
          let arritems = testParamBuilder(element.subParams);
          arr += arritems.join(",");
          arr += "]";
          output.push(arr);
          break;
        case "JSONValue":
        case "JSONObject":
          output.push("{}");
          break;
        case "TSUnionType":
          let unionitems = testParamBuilder(element.subParams);
          output.push(unionitems.join(","));
          break;
        case "Anything":
          output.push("\'anything\'");
          break;
        case "POST_LEVELS":
          output.push("Max.POST_LEVELS.INFO");
          break;
        case "TSStringKeyword":
          output.push("\'stringdata\'");
          break;
        default:
          throw new Error(
            "Parameter type " +
              element.type +
              " unknown! Please create github issue"
          );
      }
    } else {
      output = output.concat(testParamBuilder(element.subParams));
    }
  });
  return output;
}

export function commentBuilder(context, options) {
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
}

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
          let union = element.subParams.map(function (elem) {
            return commentParamBuilder([elem]);
          });
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
  if (comment.endsWith("\n*   ")) comment = comment.slice(0, -5);
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

export function returnTypeConverter(context, options) {
  let output = "";
  context.some((rtp) => {
    switch (rtp) {
      case "TSVoidKeyword":
        return true;
      case "TSNullKeyword":
        output = new Handlebars.SafeString("null");
        break;
      case "JSONObject":
        output = new Handlebars.SafeString("{}");
        break;
      case "Promise":
        break;
      default:
        throw new Error(
          "Return type " + context + " unknown! Please create github issue"
        );
        break;
    }
    return output != "";
  });
  return output;
}

export function typeRender(types, typedef) {
  return new Handlebars.SafeString(typeRenderer(types, typedef));
}

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
