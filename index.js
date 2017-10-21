#!/usr/bin/env node

const pkginfo = require('./package.json');
const program = require('commander');

let source;
let destination;
let regex;

program
  .version(pkginfo.version)
  .option('-v, --verbose', 'enable debug messages')
  .option('-O, --overwrite', 'erase all documents in an index before copying')
  .option('-R, --remove', 'remove indexes not on source')
  .option('-y, --yes', 'confirm')
  .arguments('<source> <destination> [regex of indexes to copy]')
  .usage('[options] <source> <destination> [regex of indexes to copy]')
  .action((cmdSource, cmdDestination, cmdRegex) => {
    source = cmdSource;
    destination = cmdDestination;
    regex = cmdRegex;
  });

program.on('--help', () => {
  console.log('  Examples:');
  console.log('');
  console.log('    $ migrate-elasticsearch 10.0.10.40:9200 10.0.11.40:9200');
  console.log('    $ migrate-elasticsearch 10.0.10.40:9200 10.0.11.40:9200 daily\..*');
  console.log('');
});

 program.parse(process.argv);

if(!source) {
  program.help();
}

if(program.verbose) {
  process.env.DEBUG="*";
}

const elasticsearch = require('./lib/elasticsearch');

if(program.overwrite) {
  elasticsearch.flags.overwrite = true;
}

if(program.remove) {
  elasticsearch.flags.removeExtra = true;
}

if(program.yes) {
  elasticsearch.flags.yes = true;
}

if(!source.startsWith('http')) {
  source = `http://${source}`;
}

if(!destination.startsWith('http')) {
  destination = `http://${destination}`;
}

elasticsearch.migrate(source, destination, regex);
