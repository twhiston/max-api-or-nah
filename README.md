# Max-api-or-nah

Takes a very overengineered approach to generating a max-api class outside of
the max environment. Inspired by the excellent (but now slightly out of date)
[max-api-or-not](https://github.com/dimitriaatos/max-api-or-not).

For those of us doing a lot of max coding with Typescript we can assume the
Typescript definitions to be the source of truth for the API. Therefore this
parses the current Typescript definition for the max-api from the
DefinitelyTyped library (@types/max-api) and turns it into a wrapper so that we
can still use code that includes the max-api in tests etc... It does this by
traversing the AST tree of the d.ts file containing the type definition and then
templating the output.

Additionally since inside max the `process.env.MAX_ENV` value will be set to a
member of the `MAX_ENV` enum when running something in the [node.script] object
this module sets this value to the additional value of `nah` when in use outside
of Max.

## Usage

Just npm install the module and it will generate the `index.js` when installing.

Using it manually you should clone the repo `npm install` to get all the dev
dependenciens and then `npm run build` to output `index.js`.
