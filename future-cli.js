#!/usr/local/bin/node --log_all

// == OpenJSCAD.org CLI interface, written by Rene K. Mueller <spiritdude@gmail.com>, Licensed under MIT License
//
// Description:
//   openjscad <file> [-of <format>] [-o <output>]
// e.g.
//   openjscad test.jscad
//   openjscad test.jscad -o test.stl
//   openjscad test.jscad -o test.amf
//   openjscad test.jscad -o test.dxf
//   openjscad test.scad -o testFromSCAD.jscad
//   openjscad test.scad -o test.stl
//   openjscad test.stl -o test2.stl      # reprocessed: stl -> jscad -> stl
//   openjscad test.amf -o test2.jscad
//   openjscad test.jscad -of amf
//   openjscad test.jscad -of dxf
//   openjscad test.jscad -of stl
//   openjscad name_plate.jscad --name "Just Me" --title "CEO" -o amf test.amf
//
// History:
// 2016/10/01: 0.5.2: changes for libraries
// 2016/06/27: 0.5.1: refactored AMF import and export by Z3 Dev
//                    enhanced STL import, adding support for MM colors by Z3 Dev
// 2016/02/02: 0.4.0: GUI refactored, functionality split up into more files, mostly done by Z3 Dev
// 2015/07/02: 0.3.0: node 0.10.x support, /usr/bin/nodejs, new files involved: formats.js (Stefan Baumann) and Blob.js (Z3 Dev)
// 2014/12/09: 0.019: support of DXF output for 2D objects (laser cutter)
// 2013/04/25: 0.010: support of params passed to main()
// 2013/04/12: 0.008: reimplement parseAMF without jquery
// 2013/04/11: 0.007: support of alpha for AMF addded, bumping version
// 2013/04/05: 0.006: support of AMF added, requires node 0.8.1+
// 2013/03/25: 0.005: more sanity check on input and local installation support
// 2013/03/18: 0.004: STL .stl (binary & ascii) support (experimental via openscad.js)
// 2013/03/18: 0.003: OpenSCAD .scad support by Gary Hodgson's openscad-openjscad-translator module
// 2013/03/02: 0.002: proper installation of the dependencies (csg.js & openscad.js) so openjscad can be used properly
// 2013/03/01: 0.001: initial version, with base function from openscad.jscad
//
const fs = require('fs')
const path = require('path')
const vm = require('vm')

global.time = new Date()
global.lib = !fs.existsSync(global.lib) ? __dirname+'/' : '/usr/local/lib/openjscad/' // for now hard-coded
//global.nodeModules = '/usr/local/lib/node_modules/' // for now hard-coded too

const lib = global.lib
const formatsPath = path.resolve(lib, './formats.js')
const blobPath = path.resolve(lib, './Blob.js')
const openjscadPath = path.resolve(lib, './openjscad.js')
const openscadPath = path.resolve(lib, './openscad.js')

const CSG = require(formatsPath).CSG // use the CSG with extended prototypes
const CAG = require(formatsPath).CAG // use the CAG with extended prototypes
const Blob = require(blobPath).Blob

const OpenJsCad = require(openjscadPath).OpenJsCad
const openscad = require(openscadPath)

const meta = {
  producer: `OpenJSCAD ${OpenJsCad.version}`,
  date: new Date()
}
const formatNames = {
  jscad: 'OpenJSCAD.org Source',
  js: 'JavaScript Source',
  stl: 'STereoLithography, ASCII',
  stla: 'STereoLithography, ASCII',
  stlb: 'STereoLithography, Binary',
  amf: 'Additive Manufacturing File Format',
  x3d: 'X3D File Format',
  gcode: 'G Programming Language File Format',
  dxf: 'AutoCAD Drawing Exchange Format',
  svg: 'Scalable Vector Graphics Format',
  json: 'JavaScript Object Notation Format'
}
// var csg = sphere(1);          // -- basic test
// var csg = require(file).main; // -- treating .jscad as module? later perhaps

const args = process.argv.splice(2)

// -- main code

// handle arguments
// inputs, outputs
let {inputFile, inputFormat, outputFile, outputFormat, gMainParam} = parseArgs(args)
const inputFormatHandlers = makeInputFormatHandlers()

// outputs
const output = determineOutputNameAndFormat(outputFormat, outputFile)
outputFormat = output.outputFormat
outputFile = output.outputFile

console.log(`converting ${inputFile} -> ${outputFile} (${formatNames[outputFormat]})`)

let src = fs.readFileSync(inputFile, inputFile.match(/\.stl$/i) ? 'binary' : 'UTF8')
// -- include input, and convert into JSCAD source
src = inputFormatHandlers[inputFormat](src, inputFile, outputFile)

// -- convert from JSCAD script into the desired output format
const outputData = generateOutputData(outputFormat, src, gMainParam)
// -- and write it to disk
writeOutputDataToFile(outputFile, outputData)

// -- helper functions ---------------------------------------------------------------------------------------
// -- input format handlers
function makeInputFormatHandlers () {
  function inputScadHandler (src, inputFile, outputFile) {
    var scadParser = require('openscad-openjscad-translator') // hardcoded is bad, but works
    src = scadParser.parse(src) //    doing the magick
    src = '// producer: OpenJSCAD ' + OpenJsCad.version + '\n' + src
    src = '// source: ' + outputFile + '\n\n' + src
    return src
  }

  function inputStlHandler (src, inputFile) {
    src = openscad.parseSTL(src, inputFile)
    return src
  }

  function inputAmfHandler (src, inputFile) {
    OpenJsCad = require(path.resolve(lib, './js/jscad-parseAMF.js')).OpenJsCad
    src = OpenJsCad.parseAMF(src, inputFile)
    return src
  }

  function inputObjHandler (src, inputFile) {
    src = openscad.parseOBJ(src, inputFile)
    return src
  }

  function inputGcodeHandler (src, inputFile) {
    src = openscad.parseGCode(src, inputFile)
    return src
  }

  function inputSvgHandler (src, inputFile) {
    OpenJsCad = require(path.resolve(lib, './js/jscad-parseSVG.js')).OpenJsCad
    src = OpenJsCad.parseSVG(src, inputFile)
    return src
  }

  function inputJsonHandler (src, inputFile) {
    OpenJsCad = require(path.resolve(lib, './js/jscad-parseJSON.js')).OpenJsCad
    src = OpenJsCad.parseJSON(src, inputFile)
    return src
  }

  const inputFormatHandlers = {
    'scad': inputScadHandler,
    'stl': inputStlHandler,
    'amf': inputAmfHandler,
    'gcode': inputGcodeHandler,
    'svg': inputSvgHandler,
    'json': inputJsonHandler,
    'jscad': x => x,
    undefined: x => x
  }
  return inputFormatHandlers
}

function parseArgs (args) {
  // hint: https://github.com/substack/node-optimist
  //       https://github.com/visionmedia/commander.js
  //
  // process.argv.forEach(function (val, index, array) {
  //  console.log(index + ': ' + val)
  // })
  if (args.length < 1) {
    console.log('USAGE:\n\nopenjscad [-v] <file> [-of <format>] [-o <output>]')
    console.log('\t<file>  :\tinput file (Supported types: .jscad, .js, .scad, .stl, .amf, .obj, .gcode, .svg, .json)')
    console.log('\t<output>:\toutput file (Supported types: .jscad, .stl, .amf, .dxf, .svg, .json)')
    console.log("\t<format>:\t'jscad', 'stla' (STL ASCII, default), 'stlb' (STL Binary), 'amf', 'dxf', 'svg', 'json'")
    process.exit(1)
  }

  let inputFile
  let inputFormat
  let outputFile
  let outputFormat
  let gMainParam = {}

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '-of') { // -of <format>
      outputFormat = args[++i]
    } else if (args[i].match(/^-o(\S.+)/)) { // -o<output>
      outputFile = args[i]
      outputFile = outputFile.replace(/^\-o(\S+)$/, '$1')
    } else if (args[i] === '-o') { // -o <output>
      outputFile = args[++i]
    } else if (args[i].match(/^--(\w+)=(.*)/)) { // params for main()
      gMainParam[RegExp.$1] = RegExp.$2
    } else if (args[i].match(/^--(\w+)$/)) { // params for main()
      gMainParam[RegExp.$1] = args[++i]
    } else if (args[i].match(/^--(\w+)$/)) { // params for main()
      gMainParam[RegExp.$1] = args[++i]
    } else if (args[i].match(/.+\.(jscad|js|scad|stl|amf|obj|gcode|svg|json)$/i)) {
      inputFile = args[i]
      inputFormat = RegExp.$1
      if (!fs.statSync(inputFile).isFile()) {
        console.log('ERROR: cannot open file <' + inputFile + '>')
        process.exit(1)
      }
    } else if (args[i].match(/^-v$/)) { // show the version and the environment information
      OpenJsCad.env()
      console.log('OpenSCAD Compatibility (' + openscad.version() + ')')
    } else {
      console.log('ERROR: invalid file name or argument <' + args[i] + '>')
      console.log("Type 'openjscad' for help")
      process.exit(1)
    }
  }
  // exit if a input file was not provided
  if (inputFile === null) process.exit(1)

  if (!outputFormat && !outputFile) {
    outputFormat = 'stla'
  }

  return {
    inputFile,
    inputFormat,
    outputFile,
    outputFormat,
  gMainParam}
}

function determineOutputNameAndFormat (outputFormat, outputFile) {
  if (!outputFormat && outputFile && outputFile.length && outputFile.match(/\.(jscad|js|stl|amf|dxf|svg)$/)) { // output filename set
    outputFormat = RegExp.$1
  } else if (!outputFormat && outputFile && outputFile.length) { // output filename isn't valid
    console.log('ERROR: invalid output file <' + outputFile + '>')
    process.exit(1)
  } else if (outputFormat.match(/(jscad|js|stl|stla|stlb|amf|dxf|svg)/i)) { // output format defined?
    var ext = RegExp.$1
    if (!outputFile) { // unless output filename not set, compose it
      ext = ext.replace(/stl[ab]/, 'stl') // drop [ab] from stl
      outputFile = inputFile
      outputFile = outputFile.replace(/\.([^\.]+)$/, '.' + ext) // compose output filename
    }
  } else {
    console.log(`ERROR: invalid output format <${outputFormat}`)
    process.exit(1)
  }
  return {outputFormat, outputFile}
}

function evaluateSource (src, helperFunctions, mainParams) {
  /*
  //FIXME : should we be using this one instead ?
    var processor = new OpenJsCad.Processor();
  processor.setStatus("Initialized.");

  // convert the file list
  var src = fs.readFileSync(inPath,"UTF8");

  // process the script
  processor.setJsCad(src, inPath);

  var objects = processor.currentObject;

  // UNION the objects if necessary

  // convert to the requested format
  var object = objects;
  var outPath = './junk.stl';
  var outFormat = 'stla';
  var out = processor.convertToBlob(object,outFormat);
  */

  const fullSrc = `${src}\n${helperFunctions}\nmain(_getParameterDefinitions(${JSON.stringify(mainParams)}))\n`
  let csg = eval(fullSrc)
  //auto extrude CAG
  if (csg.length) {
    let ouput = csg[0] instanceof CAG ? csg[0].extrude({offset: [0, 0, 0.1]}) : csg[0]

    for (let i = 1; i < csg.length; i++) {
      let current = csg[i] instanceof CAG ? csg[i].extrude({offset: [0, 0, 0.1]}) : csg[i]
      ouput = ouput.unionForNonIntersecting(current)
    }
    csg = ouput
  }
}

function generateOutputData (outputFormat, src, gMainParam) {
  let data
  if (outputFormat === 'jscad' || outputFormat === 'js') {
    data = new Blob([src], { type: 'application/javascript' })
  } else {
    const scad = fs.readFileSync(path.resolve(lib, './openscad.js'))
    // console.log("render jscad to "+outputFormat)
    // console.log(JSON.stringify(gMainParam))
    const fullSrc = `${src}\n${scad}\nmain(_getParameterDefinitions(${JSON.stringify(gMainParam)}))\n`
    let csg = eval(fullSrc) // src + '\n' + scad + '\nmain(_getParameterDefinitions(' + JSON.stringify(gMainParam) + '))\n') // *.jscad + openscad.js + main()

    if (csg.length) {
      var o = csg[0]
      if (o instanceof CAG) {
        o = o.extrude({offset: [0, 0, 0.1]})
      }
      for (let i = 1; i < csg.length; i++) {
        var c = csg[i]
        if (c instanceof CAG) {
          c = c.extrude({offset: [0, 0, 0.1]})
        }
        o = o.unionForNonIntersecting(c)
      }
      csg = o
    }

    const outputFormatHandlers = {
      'amf': () => csg.toAMFString(meta), // CSG to AMF
      'stlb': () => csg.toStlBinary(), // CSG to STL BINARY
      'stl': () => csg.toStlString(), // CSG to STL ASCII
      'stla': () => csg.toStlString(), // CSG to STL ASCII
      'dxf': () => cag.toDxf(), // CAG to DXF
      'svg': () => cag.toSvg(), // CAG to SVG
      'x3d': () => csg.toX3D(), // CSG to X3D Only possible via browsers
      'json': () => csg.toJSON(), // CSG or CAG to JSON
      undefined: () => {
        console.log('ERROR: only jscad, stl, amf, dxf, svg or json as output format')
        process.exit(1)
      }
    }
    data = outputFormatHandlers[outputFormat]()
  }
  console.log(`Blob: type [${data.type}] size [${data.size}]`)
  return data
}

function writeOutputDataToFile (outputFile, outputData) {
  fs.writeFile(outputFile, outputData.asBuffer(), 0,
    function (err) {
      if (err) {
        console.log('err', err)
      } else {
        console.log('success')
      }
    }
  )
}

function include (scad, fn) {
  let includes = []
  // console.log(arguments.callee.caller,"include:"+fn)
  if (0) {
    // var script = vm.createScript(fs.readFileSync(fn),fn)
    // script.runInThisContext()
    var script = vm.runInThisContext(fs.readFileSync(fn), fn)
    return script
  } else if (0) {
    includes.push(fn)
  } else {
    var src = fs.readFileSync(fn, {encoding: 'utf8'})
    // console.log("include: ",src)
    var r
    try {
      r = eval(src + scad)
    } catch(e) {
      if (e instanceof SyntaxError) {
        console.log(e.message)
      }
    }
    // echo("result:",r)
    return r
  }
}
