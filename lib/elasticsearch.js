const debug = require('debug')('app');

const request = require('request-promise-native');
const { URL } = require('url');
const chalk   = require('chalk');
const prompt = require('prompt-promise');
const ProgressBar = require('ascii-progress');
const leftPad = require('left-pad')

const timeout = 180 * 1000; // 180 seconds
const progressRefreshTimeout = 3 * 1000 // 1 seconds
const pad = 32

const totalProgressBarOpts = {
  schema: `:name.green.bold [:bar.green] :current.green.bold/:total.green.bold :percent.green.bold :elapseds.green.bold :etas.green.bold`,
  width: 100,
  clean: false
}

const taskProgressBarOpts = {
  schema: `:name [:bar] :current/:total :percent :elapseds :etas`,
  width: 100,
  clean: true
}

module.exports = {
  flags: {
    overwrite: false,
    removeExtra: false,
    yes: false
  },
  waitForTasksToComplete: async (server) => {
    debug('waitForTasksToComplete', server)
    let serverUrl = new URL(server);
    serverUrl.pathname = '/_tasks';
    serverUrl.search = 'detailed=true&actions=*reindex'

    let taskStates = {};
    let progress = new ProgressBar(totalProgressBarOpts);

    progress.tick(0, { 'name': leftPad('Total', pad)});

    do {
      debug(`posting ${serverUrl.href}`);
      let response = await request(serverUrl.href, {
        timeout: timeout,
        json: true
      })
      .catch((err) => {
        debug(err);
        if (err.message == "Error: ETIMEDOUT") {
          console.error(`Error connecting to ${destinationUrl.host}. Please check parameters`);
        } else {
          console.error(err);
        }
        process.exit(1);
      })
      .then((data) => {
        let tasks = {};
        Object.keys(data.nodes).forEach((serverName) => {
          Object.keys(data.nodes[serverName].tasks).forEach((taskId) => {
            tasks[taskId] = data.nodes[serverName].tasks[taskId];
          });
        });
        return tasks;
      })
      .then((tasks) => {
        // add new task to state and Uupdate state on current tasks
        Object.keys(tasks).forEach((taskId) => {
          if(!taskStates[taskId]) {
            taskStates[taskId] = new ProgressBar(taskProgressBarOpts);
            taskStates[taskId].id = taskId;
            taskStates[taskId].name = tasks[taskId].description.replace(/^(?:.|\n)+ to \[(.+)\]$/, '$1');
          }

          let task = tasks[taskId];
          let bar = taskStates[taskId];

          if(task.status.total > 0) {
            bar.total = task.status.total;
            let diff = task.status.updated + task.status.created + task.status.deleted - bar.current;
            bar.tick(diff, { 'name': leftPad(bar.name, pad) });
          }
        });

        // Finish missing tasks (assume complete) and add up totals
        let total = 0;
        let current = 0;
        Object.keys(taskStates).forEach((taskBarPointer) => {
          let taskBar = taskStates[taskBarPointer];
          total += taskBar.total;
          current += taskBar.current;
          if( ! Object.keys(tasks).includes(taskBar.id)) {
            taskBar.tick(taskBar.total - taskBar.current, { 'name': leftPad(taskBar.name, pad) });
          }
        });

        // Update total progress bar
        if(total > 0) {
          progress.total = total;
          progress.tick(current - progress.current, { 'name': leftPad('Total', pad)});
        }
      })
      .then( async () => {
        return await new Promise((resolve) => setTimeout(resolve, progressRefreshTimeout));
      })
    } while (!progress.completed)
    return;
  },
  listIndexes: async (server) => {
    debug('listIndexes', server);
    let serverUrl = new URL(server);
    serverUrl.pathname = '/_cat/indices';
    serverUrl.search = 'format=json';

    debug(`getting ${serverUrl.href}`);
    let list = request(serverUrl.href, {
      timeout: timeout,
      json: true
    })
    .catch((err) => {
      debug(err);
      if (err.message == "Error: ETIMEDOUT") {
        console.error(`Error connecting to ${serverUrl.host}. Please check parameters`);
      } else {
        console.error(err.message);
      }
    });

    return list;
  },
  rmIndex: async (index, server) => {
    debug('rmIndex', index, server);
    let serverUrl = new URL(server);
    serverUrl.pathname = `/${index}`;

    debug(`deleteing ${serverUrl.href}`);
    let response = await request.delete(serverUrl.href, {
      timeout: timeout,
      json: true
    })
    .catch((err) => {
      debug(err);
      if (err.message == "Error: ETIMEDOUT") {
        console.error(`Error connecting to ${serverUrl.host}. Please check parameters`);
      } else {
        console.error(err.message);
      }
    });
    debug(response);
    return response;
  },
  truncateIndex: async (index, server) => {
    debug('truncateIndex', index, server);
    let serverUrl = new URL(server);
    serverUrl.pathname = `/${index}/_delete_by_query`;

    debug(`posting ${serverUrl.href}`);
    let response = await request.post(serverUrl.href, {
      timeout: timeout,
      json: true,
      body: {
        "query": {
          "match_all": {}
        }
      }
    })
    .catch((err) => {
      debug(err);
      if (err.message == "Error: ETIMEDOUT") {
        console.error(`Error connecting to ${serverUrl.host}. Please check parameters`);
      } else {
        console.error(err.message);
      }
    });

    debug(response);
    return response;
  },
  migrateIndex: async (index, source, destination) => {
    debug('migrateIndex', index, source, destination)
    let sourceUrl = new URL(source);
    let destinationUrl = new URL(destination);
    destinationUrl.pathname = '/_reindex';
    destinationUrl.search = 'wait_for_completion=false'

    let body = {
      "source": {
        "remote": {
          "host": sourceUrl.origin
        },
        "index": index,
        "query": {
          "match_all": {}
        }
      },
      "dest": {
        "index": index
      }
    }

    if (sourceUrl.username) {
      body.source.remote.username = sourceUrl.username;
    }

    if (sourceUrl.password) {
      body.source.remote.password = sourceUrl.password;
    }

    debug(`posting ${destinationUrl.href}`);
    let response = await request.post(destinationUrl.href, {
      timeout: timeout,
      json: true,
      body: body
    })
    .catch((err) => {
      debug(err);
      if (err.message == "Error: ETIMEDOUT") {
        console.error(`Error connecting to ${destinationUrl.host}. Please check parameters`);
      } else {
        console.error(err.message);
      }
    });

    debug(response);
    return response;
  },
  filterIndexes: (indexes, regex) => {
    debug('filterIndexes', indexes.length, regex);

    let filtered = indexes.filter((item) => {
      return item.index.match(regex);
    });
    return filtered;
  },
  migrate: async (source, destination, indexRegex = ".*") => {
    debug('migrate', source, destination, indexRegex)
    console.log(`Starting migration of indexes matching ${indexRegex} from ${source} to ${destination}`);

    let srcIndexes = await es.listIndexes(source);
    let dstIndexes = await es.listIndexes(destination);

    // Filter lists to regex
    srcIndexes = es.filterIndexes(srcIndexes, indexRegex);
    dstIndexes = es.filterIndexes(dstIndexes, indexRegex);

    // dstIndexes = [{index: 'dailywhatsnew.2017-10-21', 'docs.count': 1}, {index: 'test'}]

    debug(`source index count ${srcIndexes.length}`)
    debug(`destination index count ${dstIndexes.length}`)

    // Check source index health
    let green = srcIndexes.every((index) => {
      let result = index.health == 'green';
      if(!result) {
        debug(index);
      }
      return result;
    });

    if(!green) {
      let nonGreenIndexes = srcIndexes.filter((index) => {
        return index.health != 'green';
      }).map((index) => {
        return index.index;
      });

      console.error(`${chalk.yellow('WARNING: Some indexes are not green.')}\n` +
      `\t${nonGreenIndexes.join('\n\t')}\n` +
      `${chalk.yellow('Skipping...')}`);
    }

    srcIndexes = srcIndexes.filter((index) => {
      return index.health == 'green';
    });

    debug(`filtered source index count ${srcIndexes.length}`)

    // Prepare actions
    let indexesOnDestinationToRemove = [];
    let indexesOnDestinationToTruncate = [];
    let indexesOnSourceToCopy = [];

    // Filter src indexes to ones with documents
    srcIndexes = srcIndexes.filter((srcIndex) => {
      let match = srcIndex['docs.count'] == 0;
      if(match) {
        debug(`skipping ${srcIndex.index} since it has 0 documents`);
      }
      return !match;
    });

    // Remove indexes that are not on source, match the regex and are on the destination
    if(es.flags.removeExtra && dstIndexes.length > 0) {
      indexesOnDestinationToRemove = dstIndexes.filter((dstIndex) => {
        return srcIndexes.every((srcIndex) => {
          return srcIndex.index != dstIndex.index;
        });
      }).map((index) => {
        return index.index;
      });
    }

    // If we are not overwriting filter the index list to indexes that do not
    // already exist and at have least one document.
    if(!es.flags.overwrite) {
      srcIndexes = srcIndexes.filter((srcIndex) => {
        let match = dstIndexes.find((dstIndex) => {
          return dstIndex.index == srcIndex.index && dstIndex['docs.count'] > 0;
        });
        if(match) {
          debug(`skipping ${match.index} since it already exists and has ${match['docs.count']} document(s)`);
        }
        return !match;
      });
    }

    // Truncate indexes that are on both source and destination and match the regex
    if(es.flags.overwrite) {
      indexesOnDestinationToTruncate = srcIndexes.filter((srcIndex) => {
        return dstIndexes.find((dstIndex) => {
          return dstIndex.index == srcIndex.index && dstIndex['docs.count'] > 0;
        });
      }).map((index) => {
        return index.index;
      });
    }

    indexesOnSourceToCopy = srcIndexes.map((index) => {
      return index.index;
    });

    if(indexesOnDestinationToRemove.length +
      indexesOnDestinationToTruncate.length +
      indexesOnSourceToCopy.length == 0) {
        console.log(chalk.green('Nothing to do'));
        process.exit(0);
    }

    // Confirm actions
    if(es.flags.yes) {
      console.log(chalk.green('Pending actions:'));
    }
    else {
      console.log(chalk.yellow(`Please confirm these actions will be performed on ${chalk.bold(destination)}`));
    }

    console.log(chalk.underline('ACTION \t\t INDEX'));

    indexesOnDestinationToRemove.forEach((index) => {
      console.log(`${chalk.red('REMOVE')} \t\t ${index}`);
    });

    indexesOnDestinationToTruncate.forEach((index) => {
      console.log(`${chalk.yellow('TRUNCATE')} \t ${index}`);
    });

    indexesOnSourceToCopy.forEach((index) => {
      console.log(`${chalk.green('COPY')} \t\t ${index}`);
    });

    if(!es.flags.yes) {
      await prompt.confirm(`${chalk.yellow('Confirm?')} (you must type exactly 'yes') `, {
        bool: (val) => {
          return val.trim().toLowerCase() == 'yes';
        }
      })
      .then((val) => {
        prompt.done();
        return val;
      })
      .catch((err) => {
        console.log('action canceled');
        prompt.finish();
        process.exit(0);
      });
    }

    console.log(chalk.green('Starting'));

    console.time('Total time');

    for (let i = 0; i < indexesOnDestinationToRemove.length; i++) {
      let result = await es.rmIndex(indexesOnDestinationToRemove[i], destination);
      console.log(`Removing ${indexesOnDestinationToRemove[i]}`);
    }

    for (let i = 0; i < indexesOnDestinationToTruncate.length; i++) {
      let result = await es.truncateIndex(indexesOnDestinationToTruncate[i], destination);
      console.log(`Truncating ${indexesOnDestinationToTruncate[i]} took ${result.took}ms`);
    }

    for (let i = 0; i < indexesOnSourceToCopy.length; i++) {
      let result = es.migrateIndex(indexesOnSourceToCopy[i], source, destination);
      // console.log(`Copying ${indexesOnSourceToCopy[i]} took ${result.took}ms`);
    }

    // Wait for tasks to complete and display progress
    await es.waitForTasksToComplete(destination);

    console.log(chalk.green('Complete'));
    console.timeEnd('Total time');
  },
}

const es = module.exports;
