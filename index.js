#! /usr/bin/env node

'use strict';

var fs = require('fs'),
    inquirer = require("inquirer"),
    Q = require("q"),
    xml2js = require('xml2js');


console.log('');
console.log('Welcome to SPARK.');
console.log('');
console.log('');


function main() {

    var config = {
        cwd: process.cwd()
    };

    loadPomXml(config)
        .then(loadAtlassianPluginXml)
        .then(readSpaParams)
        .then(setupSpark)
        .then(createSpa)
        .fail(function (err) {
            console.log(err);
        })
        .done();


    //if (!isSparkSetup()) {
    // create src/main/frontend
    // create src/main/frontend/package.json
    // pom.xml
    // * add dependency
    // * add frontend-maven-plugin
    // * add spark.dev.dir to systemPropertyVariables
    //}

    //setupSpa(opts);


    //console.log('Set-up of SPA complete.');
    //console.log('* Run atlas-debug');

}

function loadPomXml(config) {
    var deferred = Q.defer();

    fs.readFile(config.cwd + '/pom.xml', function (err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            var parser = new xml2js.Parser();
            parser.parseString(data, function (err, result) {
                if (err) {
                    deferred.reject(err);
                } else if (result.project.packaging[0] !== "atlassian-plugin") {
                    deferred.reject(new Error('Packaging is not \'atlassian plugin\'.'));
                } else {
                    config.pom = result;
                    deferred.resolve(config);
                }
            });
        }
    });

    return deferred.promise;
}

function loadAtlassianPluginXml(config) {
    var deferred = Q.defer();

    fs.readFile(config.cwd + '/src/main/resources/atlassian-plugin.xml', function (err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            var parser = new xml2js.Parser();
            parser.parseString(data, function (err, result) {
                if (err) {
                    deferred.reject(err);
                } else {
                    config['atlassian-plugin'] = result;
                    deferred.resolve(config);
                }
            });
        }
    });

    return deferred.promise;
}


function readSpaParams(config) {
    var deferred = Q.defer();

    inquirer.prompt(CONFIG_PARAMS, function (answers) {
        config.spa = answers;
        deferred.resolve(config);
    });

    return deferred.promise;
}

function setupSpark(config) {

    try {
        fs.mkdirSync(config.cwd + '/src/main/frontend/');
        fs.writeFileSync(config.cwd + '/src/main/frontend/test_' + config.spa.name + '.txt', "asdf");
    } catch (e) {
        console.log('src/main/frontend already exists.')
    }

    return config;
}

function createSpa(config) {
    return config;
}


var CONFIG_PARAMS = [
    {
        type: 'input',
        name: 'name',
        message: 'Name of the SPA',
        validate: function (value) {
            var pass = value.match(/^[a-z0-9_-]+$/i);
            if (pass) {
                return true;
            } else {
                return "Please enter a valid SPA name (alpha-numeric characters and '-' and '_' are allowed.";
            }
        }
    },
    {
        type: "list",
        name: "type",
        message: "Select a SPA type:",
        choices: [
            {
                name: "Dialog App",
                value: 'dialog'
            },
            {
                name: "Space App (Confluence-only)",
                value: 'space'
            },
            {
                name: "Admin App",
                value: 'admin'
            }
        ]
    },
    {
        type: "list",
        name: "framework",
        message: "Select technology:",
        'default': 'angular1',
        choices: [
            {
                name: "AngularJS 1.x",
                value: 'angular1'
            },
            {
                name: "AngularJS 2",
                value: 'angular2'
            },
            {
                name: "ReactJS",
                value: 'react'
            }
        ]
    },
    {
        type: 'confirm',
        name: 'everythingOk',
        message: function (answers) {
            return 'About to create SPA:\n' +
                '\n' +
                '  SPA Name:  ' + answers.name + '\n' +
                '  SPA Type:  ' + answers.type + '\n' +
                '  Framework: ' + answers.framework + '\n' +
                '\n' +
                'Ok?';
        },
        'default': true
    }
];


main();


// === delete below here ====
var questions = [
    {
        type: "confirm",
        name: "toBeDelivered",
        message: "Is it for a delivery",
        default: false
    },
    {
        type: "input",
        name: "phone",
        message: "What's your phone number",
        validate: function (value) {
            var pass = true; // value.match(/^([01]{1})?[\-\.\s]?\(?(\d{3})\)?[\-\.\s]?(\d{3})[\-\.\s]?(\d{4})\s?((?:#|ext\.?\s?|x\.?\s?){1}(?:\d+)?)?$/i);
            if (pass) {
                return true;
            } else {
                return "Please enter a valid phone number";
            }
        }
    },
    {
        type: "list",
        name: "size",
        message: "What size do you need",
        choices: ["Large", "Medium", "Small"],
        filter: function (val) {
            return val.toLowerCase();
        }
    },
    {
        type: "input",
        name: "quantity",
        message: "How many do you need",
        validate: function (value) {
            var valid = !isNaN(parseFloat(value));
            return valid || "Please enter a number";
        },
        filter: Number
    },
    {
        type: "expand",
        name: "toppings",
        message: "What about the toping",
        choices: [
            {
                key: "p",
                name: "Peperonni and chesse",
                value: "PeperonniChesse"
            },
            {
                key: "a",
                name: "All dressed",
                value: "alldressed"
            },
            {
                key: "w",
                name: "Hawaïan",
                value: "hawaian"
            }
        ]
    },
    {
        type: "rawlist",
        name: "beverage",
        message: "You also get a free 2L beverage",
        choices: ["Pepsi", "7up", "Coke"]
    },
    {
        type: "input",
        name: "comments",
        message: "Any comments on your purchase experience",
        default: "Nope, all good!"
    },
    {
        type: "list",
        name: "prize",
        message: "For leaving a comments, you get a freebie",
        choices: ["cake", "fries"],
        when: function (answers) {
            return answers.comments !== "Nope, all good!";
        }
    }
];
