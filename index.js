#! /usr/bin/env node

// To be installed as global package to work as a command line tool in any
// AMPS project, see: http://javascriptplayground.com/blog/2015/03/node-command-line-tool/

'use strict';

var cheerio = require('cheerio'),
    extend = require('extend'),
    debug = require('debug')('spark'),
    fs = require('fs'),
    glob = require('glob'),
    handlebars = require('handlebars'),
    inquirer = require('inquirer'),
    mkdirp = require('mkdirp'),
    path = require('path'),
    q = require('q'),
    request = require('request'),
    s = require('string');


var SPARK_VERSION = '0.9.3', // update this every once in a while (the value will be replaced with the latest version in init()).
    SPARK_MAVEN_REPO = 'https://nexus.k15t.com/content/repositories/releases',
    FRONTEND_MAVEN_PLUGIN_VERSION = '0.0.23',
    NODE_VERSION = 'v0.12.4',
    NPM_VERSION = '2.11.2';


function main(args) {

    var project = {
        cwd: process.cwd(),
        hostApp: undefined,
        spa: { // ========= this is for debugging only (comment out .then(readSpaParams))
            key: 'default-spa-key',
            keyForJavaPackage: 'default_spa_key',
            name: 'Default SPA Name',
            path: path.join(process.cwd(), 'src', 'main', 'spark', 'default-spa-key'),
            type: 'dialog',
            template: {
                name: 'angular1x-helloworld',
                framework: 'angular1x',
                path: path.join(__dirname, 'templates', 'confluence', 'angular1x-helloworld')
            }
        },     // ========= /this is for debugging only
        atlassianPlugin: {
            path: path.join(process.cwd(), 'src', 'main', 'resources', 'atlassian-plugin.xml'),
            $: undefined
        },
        pom: {
            path: path.join(process.cwd(), 'pom.xml'),
            $: undefined
        },
        sparkDir: {
            path: path.join(process.cwd(), 'src', 'main', 'spark')
        },
        packageJson: {
            path: path.join(process.cwd(), 'src', 'main', 'spark', 'package.json'),
            json: undefined
        }
    };


    loadPomXml(project)
        .then(showWelcomeMessage)
        .then(getHostApp)
        .then(loadAtlassianPluginXml)
        .then(getLatestSparkVersion)
        .then(readSpaParams)

        .then(setupSparkDir)
        .then(setupPackageJson)
        .then(manipulatePomXml)

        .then(manipulateAtlassianPluginXml)
        .then(createTemplateApp)
        .then(generateAppAction)

        .then(addDevDependencies)

        .then(showSuccessInfo)

        .fail(function (err) {
            debug.enabled || console.log('...... ' + err.message);
            debug(err.stack);
        })
        .done();

}

debug('Debugging enabled.');

function loadPomXml(project) {
    var deferred = q.defer();

    fs.readFile(project.pom.path, function (err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                deferred.reject(new Error('Can\'t open pom.xml. Is this an Atlassian SDK project?'));
            } else {
                deferred.reject(err);
            }
        } else {
            project.pom.$ = cheerio.load(data);

            if (project.pom.$('project > packaging').text() !== 'atlassian-plugin') {
                deferred.reject(new Error('Packaging is not \'atlassian plugin\'. Is this an Atlassian SDK project?'));
            }

            deferred.resolve(project);
        }
    });

    return deferred.promise;
}

function getHostApp(project) {
    var deferred = q.defer();
    var hostApp = '';

    try {
        var artifactId = project.pom.$('project > build > plugins > plugin:has(> groupId:contains("com.atlassian.maven.plugins")) > artifactId').text();
        debug('AMPS artifact Id: ' + artifactId);
        hostApp = artifactId.match(/^maven-(confluence|jira|stash)-plugin$/)[1];
        debug('hostApp: ' + hostApp);
    } catch (e) {
        deferred.reject(e);
    }

    if (['confluence'].indexOf(hostApp) === -1 && ['jira'].indexOf(hostApp) === -1) { // TODO change when we support JIRA or Stash
        deferred.reject(new Error('Unsupported host app: \'' + hostApp + '\'. We only support Confluence and Jira currently.'));
    }

    project.hostApp = hostApp;

    deferred.resolve(project);
    return deferred.promise;
}

function showWelcomeMessage(project) {
    console.log('');
    console.log('SPARK // Create Single Page App');

    return q.resolve(project);
}

function loadAtlassianPluginXml(project) {
    var deferred = q.defer();

    fs.readFile(project.atlassianPlugin.path, function (err, data) {
        if (err) {
            deferred.reject(err);
        } else {
            project.atlassianPlugin.$ = cheerio.load(data);
            deferred.resolve(project);
        }
    });

    return deferred.promise;
}

function getLatestSparkVersion(project) {
    var deferred = q.defer();

    request(SPARK_MAVEN_REPO + '/com/k15t/spark/spark/maven-metadata.xml', function (error, response, html) {
        if (!error && response.statusCode == 200) {
            var $ = cheerio.load(html, {
                withDomLvl1: true,
                withStartIndices: true,
                xmlMode: true
            });

            SPARK_VERSION = $('metadata versioning release').text();
            deferred.resolve(project);
        } else {
            debug('Could not load detect latest SPARK version. Using ' + SPARK_VERSION + '.');
            deferred.resolve(project);
        }

    });

    return deferred.promise;
}

function readSpaParams(project) {
    var deferred = q.defer();

    inquirer.prompt(getPromptMessages(project), function (answers) {
        project.spa = answers;

        if (!answers.everythingOk) {
            deferred.reject(new Error('Aborted.'));
        } else {
            project.spa.path = path.join(project.sparkDir.path, project.spa.key);
            project.spa.keyForJavaPackage = project.spa.key.replace(/-/g, '_');
            delete project.spa.everythingOk;
            deferred.resolve(project);
        }
    });

    return deferred.promise;
}

function getPromptMessages(project) {
    if (['confluence'].indexOf(project.hostApp) > -1) {
        return getConfluencePromptMessages(project);
    } else if (['jira'].indexOf(project.hostApp) > -1) {
        return getJiraPromptMessages(project);
    }
}

function getConfluencePromptMessages(project) {
    var promptMessage = [
        {
            type: 'input',
            name: 'key',
            message: 'Key (e.g. \'scroll-config\')',
            validate: function (value) {
                var pass = value.match(/^[a-z][a-z0-9_-]+$/i);
                if (pass) {
                    if (fs.existsSync(path.join(project.sparkDir.path, value))) {
                        return "SPA key '" + value + "' already exists.";
                    } else {
                        return true;
                    }
                } else {
                    return "Please enter a valid SPA key (starts with a letter & contains only alpha-numeric characters, '-', and '_'.";
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
                    name: 'Admin App - Creates an application which will be part of the global admin console.',
                    value: 'admin'
                },
                {
                    name: 'Dialog App - Creates an application which runs in a modal dialog and can be integrated for example in Confluence on every page.',
                    value: 'dialog'
                },
                {
                    name: 'Space App (Confluence-only) - Creates an application which will be integrated as part of the Confluence Space Tools',
                    value: 'space'
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
                    name: 'AngularJS 1.x (with Gulp and Bower support)',
                    value: 'angular1x-gulp-bower'
                }
            ],
            filter: function (value) {
                return ({
                    'angular1x-helloworld': {
                        name: 'angular1x-helloworld',
                        framework: 'angular1x',
                        path: path.join(__dirname, 'templates', project.hostApp, 'angular1x-helloworld')
                    },
                    'angular1x-gulp-bower': {
                        name: 'angular1x-gulp-bower',
                        framework: 'angular1x',
                        path: path.join(__dirname, 'templates', project.hostApp, 'angular1x-gulp-bower')
                    }
                })[value];
            }
        },
        {
            type: 'confirm',
            name: 'everythingOk',
            message: 'About to create SPA. Everything ok?',
            'default': true
        }
    ];

    return promptMessage;
}

function getJiraPromptMessages(project) {
    var promptMessage = [
        {
            type: 'input',
            name: 'key',
            message: 'Key (e.g. \'scroll-config\')',
            validate: function (value) {
                var pass = value.match(/^[a-z][a-z0-9_-]+$/i);
                if (pass) {
                    if (fs.existsSync(path.join(project.sparkDir.path, value))) {
                        return "SPA key '" + value + "' already exists.";
                    } else {
                        return true;
                    }
                } else {
                    return "Please enter a valid SPA key (starts with a letter & contains only alpha-numeric characters, '-', and '_'.";
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
                    name: 'Admin App - Creates an application which will be part of the global admin console.',
                    value: 'admin'
                },
                {
                    name: 'Dialog App - Creates an application which runs in a modal dialog and can be integrated for example in Confluence on every page.',
                    value: 'dialog'
                },
                {
                    name: 'Project App (JIRA-only) - Creates an application which ... TODO',
                    value: 'project'
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
                    name: 'AngularJS 1.x (with Gulp and Bower support)',
                    value: 'angular1x-gulp-bower'
                }
            ],
            filter: function (value) {
                return ({
                    'angular1x-helloworld': {
                        name: 'angular1x-helloworld',
                        framework: 'angular1x',
                        path: path.join(__dirname, 'templates', project.hostApp, 'angular1x-helloworld')
                    },
                    'angular1x-gulp-bower': {
                        name: 'angular1x-gulp-bower',
                        framework: 'angular1x',
                        path: path.join(__dirname, 'templates', project.hostApp, 'angular1x-gulp-bower')
                    }
                })[value];
            }
        },
        {
            type: 'confirm',
            name: 'everythingOk',
            message: 'About to create SPA. Everything ok?',
            'default': true
        }
    ];

    return promptMessage;
}

function setupSparkDir(project) {
    if (fs.existsSync(project.spa.path)) {
        return q.reject(new Error("SPA key '" + project.spa.key + "' already exists."));
    }

    try {
        fs.mkdirSync(project.sparkDir.path);
        return q.resolve(project);

    } catch (e) {
        if (e.code === 'EEXIST') {
            debug('\'' + project.sparkDir.path + '\' already exists.');
            return q.resolve(project);

        } else {
            return q.reject(e);
        }
    }
}

function setupPackageJson(project) {
    if (fs.existsSync(project.packageJson.path)) {
        debug('\'' + project.packageJson.path + '\' already exists.');

    } else {
        try {
            fs.writeFileSync(project.packageJson.path, JSON.stringify({
                'name': project.pom.$('project > artifactId').text(),
                'version': '0.0.1',
                'devDependencies': {}
            }, null, 2) + '\n');
        } catch (e) {
            return q.reject(e);
        }
    }

    try {
        var packageJsonContent = fs.readFileSync(project.packageJson.path, 'utf8');
        project.packageJson.json = JSON.parse(packageJsonContent);
        return q.resolve(project);

    } catch (e) {
        return q.reject(e);
    }
}

function manipulatePomXml(project) {
    var deferred = q.defer();

    _manipulate(project.pom.path, function addDependency($, rawContent) {
        if ($('project > repositories > repository > url:contains(' + SPARK_MAVEN_REPO + ')').length) {
            // repository already set up
            return rawContent;
        }

        var position = $('project > dependencies')[0].startIndex;
        var text = '<repositories><!-- added by spark-tools -->\n' +
            '        <repository>\n' +
            '            <id>spark-repo</id>\n' +
            '            <name>K15t SPARK Repository</name>\n' +
            '            <url>' + SPARK_MAVEN_REPO + '</url>\n' +
            '            <layout>default</layout>\n' +
            '        </repository>\n' +
            '    </repositories><!-- /added by spark-tools -->\n\n    ';
        return [rawContent.slice(0, position), text, rawContent.slice(position)].join('');
    });

    _manipulate(project.pom.path, function addK15tRepository($, rawContent) {
        if ($('project > dependencies > dependency > groupId:contains("com.k15t.spark")').length) {
            // dependency already set up
            return rawContent;
        }

        var position = $('project > dependencies > dependency')[0].startIndex;
        var text = '<dependency><!-- added by spark-tools -->\n' +
            '            <groupId>com.k15t.spark</groupId>\n' +
            '            <artifactId>spark-' + project.hostApp + '</artifactId>\n' +
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
            text = '<spark.dev.dir>${project.basedir}/target/spark-dev-builds</spark.dev.dir><!-- added by spark-tools/ -->\n                                            ';

        } else if (ampsEl.has('configuration *')) {
            position = ampsEl.find('configuration *')[0].startIndex;
            text = '<systemPropertyVariables><!-- added by spark-tools -->\n' +
                '                        <spark.dev.dir>${project.basedir}/target/spark-dev-builds</spark.dev.dir>\n' +
                '                    </systemPropertyVariables><!-- /added by spark-tools -->\n                    ';

        } else {
            position = ampsEl.startIndex;
            text = '<configuration><!-- added by spark-tools -->' +
                '                    <systemPropertyVariables>\n' +
                '                        <spark.dev.dir>${project.basedir}/target/spark-dev-builds</spark.dev.dir>\n' +
                '                    </systemPropertyVariables>\n' +
                '                </configuration><!-- /added by spark-tools -->\n                ';
        }

        return [rawContent.slice(0, position), text, rawContent.slice(position)].join('');
    });

    _manipulate(project.pom.path, function addFrontendMavenPlugin($, rawContent) {
        var mfpEl = $('project > build > plugins > plugin:has(> groupId:contains("com.github.eirslett")):has(> artifactId:contains("frontend-maven-plugin"))');

        var text, position;

        if (!mfpEl.length) {
            position = $('project > build > plugins > plugin:last-child')[0].startIndex;
            text = '<plugin><!-- added by spark-tools -->\n' +
                '                <groupId>com.github.eirslett</groupId>\n' +
                '                <artifactId>frontend-maven-plugin</artifactId>\n' +
                '                <version>' + FRONTEND_MAVEN_PLUGIN_VERSION + '</version>\n' +
                '                <configuration>\n' +
                '                    <workingDirectory>src/main/spark</workingDirectory>\n' +
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
                '                    <!-- @@spark-tools:build.execs@@ -->\n' +    // TODO @stefan find better solution for this
                '                </executions>\n' +
                '            </plugin><!-- /added by spark-tools -->\n            ';

            return [rawContent.slice(0, position), text, rawContent.slice(position)].join('');

        } else {
            return rawContent;
        }
    });

    _manipulate(project.pom.path, function addGulpExecution($, rawContent) {
        var executionFragment = _renderFragment(project, path.join(project.spa.template.path, '_fragments', 'pom-execution.handlebars')) + '\n' +
            '                    <!-- @@spark-tools:build.execs@@ -->';             // TODO @stefan this is not nice...
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
    return handlebars.compile(templateString, {
        strict: true
    })(project);
}

var helpersInitialized = false;
function _registerHandlebarHelpers(project) {
    if (helpersInitialized) {
        return;
    }

    handlebars.registerHelper({
        'isAdminApp': function (options) {
            return (project.spa.type === 'admin') ? options.fn(this) : options.inverse(this);
        },
        'isSpaceApp': function (options) {
            return (project.spa.type === 'space' || project.spa.type === 'project') ? options.fn(this) : options.inverse(this);
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
    var text = _renderFragment(project, path.join(project.spa.template.path, '_fragments', 'atlassian-plugin.handlebars'));

    var atlassianPluginXmlContent = fs.readFileSync(project.atlassianPlugin.path, 'utf8');
    var output = atlassianPluginXmlContent.replace('</atlassian-plugin>', text + '\n</atlassian-plugin>');

    fs.writeFileSync(project.atlassianPlugin.path, output, 'utf8');

    return q.resolve(project);
}

function createTemplateApp(project) {
    var deferred = q.defer();

    if (!fs.existsSync(project.spa.path)) {
        debug(project.spa.path);
        fs.mkdirSync(project.spa.path);
    }

    glob('**/*', {
        cwd: project.spa.template.path,
        ignore: '_fragments/**'
    }, function (err, files) {
        var output;

        files.forEach(function (file) {
            var src = path.join(project.spa.template.path, file);
            var dest = path.join(project.cwd, file.replace('__spa.key__', project.spa.key));

            if (fs.statSync(src).isDirectory()) {
                if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest);
                }

            } else if (s(src).endsWith('.handlebars')) {
                output = _renderFragment(project, src);
                var filename = s(dest).chompRight('.handlebars').s;
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


function generateAppAction(project) {
    if (['confluence'].indexOf(project.hostApp) > -1) {
        return generateSpaceAppAction(project);
    } else if (['jira'].indexOf(project.hostApp) > -1) {
        return generateProjectAppAction(project);
    }
}

function generateSpaceAppAction(project) {
    if (project.spa.type === 'space') {
        var templatePath = path.join(project.spa.template.path, '_fragments', 'GeneratedSpaceAppAction.java.handlebars');
        var templateString = fs.readFileSync(templatePath, 'utf8');
        var spaceActionJava = handlebars.compile(templateString, {
            strict: true
        })(project);

        var packagePath = path.join(process.cwd(), 'src', 'main', 'java', 'spark', 'GENERATED', project.spa.keyForJavaPackage);
        mkdirp.sync(packagePath, '0755' );
        fs.writeFileSync(path.join(packagePath, 'GeneratedSpaceAppAction.java'), spaceActionJava);
    }

    return q.resolve(project);
}

function generateProjectAppAction(project) {
    if (project.spa.type === 'project') {
        var templatePath = path.join(project.spa.template.path, '_fragments', 'GeneratedJiraAppAction.java.handlebars');
        var templateString = fs.readFileSync(templatePath, 'utf8');
        var spaceActionJava = handlebars.compile(templateString, {
            strict: true
        })(project);

        var packagePath = path.join(process.cwd(), 'src', 'main', 'java', 'spark', 'GENERATED', project.spa.keyForJavaPackage);

        console.log('packagePath: ' + packagePath);

        mkdirp.sync(packagePath, '0755' );
        // TODO single template name but switch here based on class from template?
        fs.writeFileSync(path.join(packagePath, 'GeneratedJiraAppAction.java'), spaceActionJava);
    }

    return q.resolve(project);
}

function addDevDependencies(project) {
    try {
        var packageJsonFragmentPath = path.join(project.spa.template.path, '_fragments', 'package.json');
        var packageJsonFragmentContent = fs.readFileSync(packageJsonFragmentPath, 'utf8');
        var packageJsonFragment = JSON.parse(packageJsonFragmentContent);

        project.packageJson.json = extend(true, project.packageJson.json, packageJsonFragment);

        fs.writeFileSync(project.packageJson.path, JSON.stringify(project.packageJson.json, null, 2) + '\n');
        return q.resolve(project);

    } catch (e) {
        return q.reject(e);
    }
}

function showSuccessInfo(project) {
    console.log('Set-up of SPA complete.');
    console.log('Run \'atlas-debug\' to run development system and look for navigation entry named ' + project.spa.name + '.');
    console.log('If the development system is already running, build and deploy with \'atlas-package && atlas-install-plugin\'.');

    return q.resolve(project);
}

main();
