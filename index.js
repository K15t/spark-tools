#! /usr/bin/env node

// To be installed as global package to work as a command line tool in any
// AMPS project, see: http://javascriptplayground.com/blog/2015/03/node-command-line-tool/

// TODO check for existing SPA names

'use strict';

var cheerio = require('cheerio'),
    fs = require('fs'),
    glob = require('glob'),
    Handlebars = require('handlebars'),
    inquirer = require('inquirer'),
    path = require('path'),
    Q = require('q'),
    S = require('string'),
    xml2js = require('xml2js');


var DEBUG = false,
    SPARK_VERSION = '0.9.1-SNAPSHOT',
    FRONTEND_MAVEN_PLUGIN_VERSION = '0.0.23',
    NODE_VERSION = 'v0.10.33',
    NPM_VERSION = '1.4.28',
    CONFIG_PARAMS = [
        {
            type: 'input',
            name: 'key',
            message: 'Key',
            validate: function (value) {
                var pass = value.match(/^[a-z][a-z0-9_-]+$/i);
                if (pass) {
                    return true;
                } else {
                    return "Please enter a valid SPA key (start with a letter & only alpha-numeric characters and '-' and '_' are allowed.";
                }
            }
        },
        {
            type: 'input',
            name: 'name',
            message: 'Name'
        },
        {
            type: 'list',
            name: 'type',
            message: 'SPA Type:',
            choices: [
                {
                    name: 'Dialog App',
                    value: 'dialog'
                },
                {
                    name: 'Space App (Confluence-only)',
                    value: 'space'
                },
                {
                    name: 'Admin App',
                    value: 'admin'
                }
            ]
        },
        {
            type: 'list',
            name: 'template',
            message: 'SPA Template:',
            'default': 'angular1x-helloworld',
            choices: [
                {
                    name: 'AngularJS 1.x (Hello World)',
                    value: 'angular1x-helloworld'
                },
                {
                    name: 'AngularJS 1.x (with Gulp)',
                    value: 'angular1x-gulp'
                }
            ]
        },
        {
            type: 'confirm',
            name: 'everythingOk',
            message: 'About to create SPA. Everything ok?',
            'default': true
        }
    ];


var __dirname;


function main(args) {

    __dirname = path.dirname(process.mainModule.filename);

    var project = {
        cwd: process.cwd(),
        hostApp: 'confluence',
        spa: { // ========= TODO @stefan remove, this is temp only (to be loaded from inquirer)
            name: 'spx-asdfasdfasdf',
            type: 'dialog',
            template: 'angular1x-helloworld',
            framework: 'angular1x'
        },     // ========= /this is temp only
        atlassianPlugin: {
            path: path.join(process.cwd(), 'src', 'main', 'resources', 'atlassian-plugin.xml'),
            json: undefined
        },
        pom: {
            path: path.join(process.cwd(), 'pom.xml'),
            json: undefined
        },
        frontendDir: {
            path: path.join(process.cwd(), 'src', 'main', 'frontend')
        },
        packageJson: {
            path: path.join(process.cwd(), 'src', 'main', 'frontend', 'package.json'),
            json: undefined
        }
    };


    loadPomXml(project)
        .then(showWelcomeMessage)
        .then(loadAtlassianPluginXml)
        .then(readSpaParams)

        .then(setupFrontendDir)
        .then(setupPackageJson)
        .then(manipulatePomXml)

        .then(manipulateAtlassianPluginXml)
        .then(createTemplateApp)

        .then(addDevDependencies)

        .then(showSuccessInfo)

        .fail(function (err) {
            DEBUG || console.log('...... ' + err.message);
            DEBUG && console.log(err.stack);
        })
        .done();

}

function loadPomXml(project) {
    var deferred = Q.defer();

    fs.readFile(project.pom.path, function (err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                deferred.reject(new Error('Can\'t open pom.xml.'));
            } else {
                deferred.reject(err);
            }
        } else {
            var parser = new xml2js.Parser();
            parser.parseString(data, function (err, result) {
                if (err) {
                    deferred.reject(err);
                } else if (result.project.packaging[0] !== 'atlassian-plugin') {
                    deferred.reject(new Error('Packaging is not \'atlassian plugin\'.'));
                } else {
                    project.pom.json = result;
                    deferred.resolve(project);
                }
            });
        }
    });

    return deferred.promise;
}

function showWelcomeMessage(project) {
    var deferred = Q.defer();

    console.log('');
    console.log('SPARK // Create Single Page App');

    deferred.resolve(project);
    return deferred.promise;
}

function loadAtlassianPluginXml(project) {
    var deferred = Q.defer();

    fs.readFile(project.atlassianPlugin.path, function (err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            var parser = new xml2js.Parser();
            parser.parseString(data, function (err, result) {
                if (err) {
                    deferred.reject(err);
                } else {
                    project.atlassianPlugin.json = result;
                    deferred.resolve(project);
                }
            });
        }
    });

    return deferred.promise;
}

function readSpaParams(project) {
    var deferred = Q.defer();

    inquirer.prompt(CONFIG_PARAMS, function (answers) {
        project.spa = answers;

        if (!answers.everythingOk) {
            deferred.reject(new Error('Aborted.'));
        } else {
            project.spa.framework = 'angular1x';  // we only support angular 1x at the moment
            project.spa.path = path.join('src', 'main', 'frontend', project.spa.key);
            delete project.spa.everythingOk;
            deferred.resolve(project);
        }
    });

    return deferred.promise;
}

function setupFrontendDir(project) {
    var deferred = Q.defer();

    try {
        fs.mkdirSync(project.frontendDir.path);
        deferred.resolve(project);

    } catch (e) {
        if (e.code === 'EEXIST') {
            console.log('\'' + project.frontendDir.path + '\' already exists.');
            deferred.resolve(project);

        } else {
            deferred.reject(e);
        }
    }

    return deferred.promise;
}

function setupPackageJson(project) {
    var deferred = Q.defer();

    if (fs.existsSync(project.packageJson.path)) {
        console.log('\'' + project.packageJson.path + '\' already exists.');

    } else {
        try {
            fs.writeFileSync(project.packageJson.path, JSON.stringify({
                'name': project.pom.json.project.artifactId[0],
                'version': '0.0.1',
                'devDependencies': {
                    'gulp': '^3.8.11'
                }
            }, null, 2) + '\n');
        } catch (e) {
            deferred.reject(e);
        }
    }

    try {
        var packageJsonContent = fs.readFileSync(project.packageJson.path, 'utf8');
        project.packageJson.json = JSON.parse(packageJsonContent);
        deferred.resolve(project);

    } catch (e) {
        deferred.reject(e);
    }

    return deferred.promise;
}

function manipulatePomXml(project) {
    var deferred = Q.defer();

    _manipulate(project.pom.path, function addDependency($, rawContent) {
        if ($('project > dependencies > dependency > groupId:contains("com.k15t.spark")').length) {
            // dependency already set up
            return rawContent;
        }

        var position = $('project > dependencies > dependency')[0].startIndex;
        var text = '<dependency><!-- added by spark-tools -->\n' +
            '            <groupId>com.k15t.spark</groupId>\n' +
            '            <artifactId>spark-confluence</artifactId>\n' +
            '            <version>' + SPARK_VERSION + '</version>\n' +
            '        </dependency><!-- /added by spark-tools -->\n        ';
        return [rawContent.slice(0, position), text, rawContent.slice(position)].join('');
    });

    _manipulate(project.pom.path, function addSparkSystemProperty($, rawContent) {
        var ampsEl = $('build plugins plugin groupId:contains("com.atlassian.maven.plugins")').parent();

        if (!ampsEl.length) {
            throw new Error('No Atlassian SDK (AMPS) found.');
        }

        // TODO check for empty elements (configuration, systemPropertyVariables)

        var text, position;

        if (ampsEl.find('configuration systemPropertyVariables spark\\.dev\\.dir').length) {
            return rawContent;

        } else if (ampsEl.find('configuration systemPropertyVariables *').length) {
            position = ampsEl.find('configuration systemPropertyVariables *')[0].startIndex;
            text = '<spark.dev.dir>${project.basedir}/target/spark</spark.dev.dir><!-- added by spark-tools/ -->\n                                            ';

        } else if (ampsEl.has('configuration *')) {
            position = ampsEl.find('configuration *')[0].startIndex;
            text = '<systemPropertyVariables><!-- added by spark-tools -->\n' +
                '                        <spark.dev.dir>${project.basedir}/target/spark</spark.dev.dir>\n' +
                '                    </systemPropertyVariables><!-- /added by spark-tools -->\n                    ';

        } else {
            position = ampsEl.startIndex;
            text = '<configuration><!-- added by spark-tools -->' +
                '                    <systemPropertyVariables>\n' +
                '                        <spark.dev.dir>${project.basedir}/target/spark</spark.dev.dir>\n' +
                '                    </systemPropertyVariables>\n' +
                '                </configuration><!-- /added by spark-tools -->\n                ';
        }

        return [rawContent.slice(0, position), text, rawContent.slice(position)].join('');
    });

    _manipulate(project.pom.path, function addFrontendMavenPlugin($, rawContent) {
        var mfpEl = $('project > build > plugins > plugin' +
        '        :has(> groupId:contains("com.github.eirslett"))' +
        '        :has(> artifactId:contains("frontend-maven-plugin"))');

        var text, position;

        if (!mfpEl.length) {
            position = $('project > build > plugins > plugin:last-child')[0].startIndex;
            text = '<plugin><!-- added by spark-tools -->\n' +
                '                <groupId>com.github.eirslett</groupId>\n' +
                '                <artifactId>frontend-maven-plugin</artifactId>\n' +
                '                <version>' + FRONTEND_MAVEN_PLUGIN_VERSION + '</version>\n' +
                '                <configuration>\n' +
                '                    <workingDirectory>src/main/frontend</workingDirectory>\n' +
                '                </configuration>\n' +
                '                <executions>\n' +
                '                    <execution>\n' +
                '                        <id>install-node-and-npm</id>\n' +
                '                        <goals>\n' +
                '                            <goal>install-node-and-npm</goal>\n' +
                '                        </goals>\n' +
                '                        <configuration>\n' +
                '                            <nodeVersion>' + NODE_VERSION + '</nodeVersion>\n' +
                '                            <npmVersion>' + NPM_VERSION + '</npmVersion>\n' +
                '                        </configuration>\n' +
                '                    </execution>\n' +
                '                    <execution>\n' +
                '                        <id>npm-install</id>\n' +
                '                        <goals>\n' +
                '                            <goal>npm</goal>\n' +
                '                        </goals>\n' +
                '                    </execution>\n' +
                '                    <!-- @@spark-tools:build.execs@@ -->\n' +    // TODO find better solution for this
                '                </executions>\n' +
                '            </plugin><!-- /added by spark-tools -->\n            ';

            return [rawContent.slice(0, position), text, rawContent.slice(position)].join('');

        } else {
            return rawContent;
        }
    });

    _manipulate(project.pom.path, function addGulpExecution($, rawContent) {
        var executionFragment = _renderFragment(project, path.join(__dirname, 'templates', 'pom-execution.handlebars')) + '\n' +
            '                    <!-- @@spark-tools:build.execs@@ -->';
        return rawContent.replace('<!-- @@spark-tools:build.execs@@ -->', executionFragment);
    });

    deferred.resolve(project);
    return deferred.promise;
}

function _manipulate(file, callback) {
    var pomXmlContent = fs.readFileSync(file, 'utf8');

    var $ = cheerio.load(pomXmlContent, {
        withDomLvl1: true,
        withStartIndices: true,
        xmlMode: true
    });

    var output = callback($, pomXmlContent);
    fs.writeFileSync(file, output, 'utf8');
}

function _renderFragment(project, template) {
    _registerHandlebarHelpers(project);

    var templateString = fs.readFileSync(template, 'utf8');
    return Handlebars.compile(templateString, {
        strict: true
    })(project);
}

var helpersInitialized = false;
function _registerHandlebarHelpers(project) {
    if (helpersInitialized) {
        return;
    }

    Handlebars.registerHelper({
        'isAdminApp': function (options) {
            return (project.spa.type === 'admin') ? options.fn(this) : options.inverse(this);
        },
        'isSpaceApp': function (options) {
            return (project.spa.type === 'space') ? options.fn(this) : options.inverse(this);
        },
        'isDialogApp': function (options) {
            return (project.spa.type === 'dialog') ? options.fn(this) : options.inverse(this);
        },
        'isAdminOrSpaceApp': function (options) {
            return (project.spa.type === 'admin') || (project.spa.type === 'space') ?
                options.fn(this) :
                options.inverse(this);
        }
    });

    helpersInitialized = true;
}

function manipulateAtlassianPluginXml(project) {
    var deferred = Q.defer();

    var text = _renderFragment(project, path.join(__dirname, 'templates', 'confluence', 'atlassian-plugin.handlebars'));

    var atlassianPluginXmlContent = fs.readFileSync(project.atlassianPlugin.path, 'utf8');
    var output = atlassianPluginXmlContent.replace('</atlassian-plugin>', text + '\n</atlassian-plugin>');

    fs.writeFileSync(project.atlassianPlugin.path, output, 'utf8');

    deferred.resolve(project);
    return deferred.promise;
}

function createTemplateApp(project) {
    var deferred = Q.defer();

    var templateDir = path.join(__dirname, 'templates', project.hostApp, project.spa.template);
    var spaDir = path.join(project.cwd, 'src', 'main', 'frontend', project.spa.key);

    if (!fs.existsSync(spaDir)) {
        fs.mkdirSync(spaDir);
    }

    glob('**/*', {
        cwd: templateDir
    }, function (err, files) {
        var output;

        files.forEach(function (file) {
            var src = path.join(templateDir, file);
            var dest = path.join(project.cwd, file.replace('__spa.key__', project.spa.key));

            if (fs.statSync(src).isDirectory()) {
                if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest);
                }

            } else if (S(src).endsWith('.handlebars')) {
                output = _renderFragment(project, src);
                var filename = S(dest).chompRight('.handlebars').s;
                fs.writeFileSync(filename, output, 'utf8');

            } else {
                output = fs.readFileSync(src, 'utf8');
                fs.writeFileSync(dest, output, 'utf8');
            }
        });

        deferred.resolve(project);
    });

    return deferred.promise;
}

function addDevDependencies(project) {
    var deferred = Q.defer();

    // TODO have templates add their dependencies here

    deferred.resolve(project);
    return deferred.promise;
}

function showSuccessInfo(project) {
    var deferred = Q.defer();

    console.log('Set-up of SPA complete.');
    console.log('Run \'atlas-debug\' to run development system.');

    deferred.resolve(project);
    return deferred.promise;
}

main();
