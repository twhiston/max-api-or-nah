# Max-api-or-nah

Takes a very overengineered approach to generating a max-api class outside of
the max environment. Parses the current Typescript definition for the max-api
from the DefinitelyTyped library and turns it into a wrapper

## Usage

`npm run generate-shim` and then you can use it. This will get turned into a
call that happens when you install it.

## TODO

Is there a nicer way to extract the details instead of the manual traversal?
Are there some helper methods in Babel?
