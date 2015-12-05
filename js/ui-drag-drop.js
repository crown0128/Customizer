// -----------------------------------------------------------------------------------------------------------
// Drag'n'Drop Functionality
// from old OpenJsCad processfile.html by Joost Nieuwenhuijse,
//     with changes by Rene K. Mueller
// History:
// 2013/04/02: massively upgraded to support multiple-files (chrome & firefox) and entire directory drag'n'drop (chrome only)

// --- Dependencies
// * gProcessor var
// * putSourceInEditor function
// * #conversionWorker element with the worker code
// * #filedropzone element
// * #filedropzone_filled element
// * #filedropzone_empty element
// * #currentfile element

// --- Global Variables
var gCurrentFiles = [];       // linear array, contains files (to read)
var gMemFs = [];              // associated array, contains file content in source gMemFs[i].{name,source}

// --- Public API

function setupDragDrop() {
  // Check for the various File API support.
  if (window.File && window.FileReader && window.FileList) {
    // Great success! All the File APIs are supported.
  } else {
    throw new Error("Error: Your browser does not support the HTML File API");
  }
  var dropZone = document.getElementById('filedropzone');
  dropZone.addEventListener('dragover', function(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
  }, false);
  dropZone.addEventListener('drop', handleFileSelect, false);
};

function reloadAllFiles() {
  superviseAllFiles({forceReload:true});
};

function toggleAutoReload() {
  if (document.getElementById("autoreload").checked) {
    autoReloadTimer = setInterval(function(){superviseAllFiles();}, 1000);
  } else {
    if (autoReloadTimer !== null) {
      clearInterval(autoReloadTimer);
      autoReloadTimer = null;
    }
  }
};

// --- Private Variables
var autoReloadTimer = null;

var gCurrentFile = null;

var gMemFsCount = 0;          // async reading: count of already read files
var gMemFsTotal = 0;          // async reading: total files to read (Count==Total => all files read)
var gMemFsChanged = 0;        // how many files have changed
var gRootFs = [];             // root(s) of folders

// --- Private API

function handleFileSelect(evt) {
  evt.stopPropagation();
  evt.preventDefault();

  if(!evt.dataTransfer) throw new Error("Event is not a datatransfer (1)");
  if(!evt.dataTransfer.files) throw new Error("Event is not a datatransfer (2)");

  gMemFs = []; gMainFile = null;

  if(evt.dataTransfer.items && evt.dataTransfer.items.length) {     // full directories, let's try
    var items = evt.dataTransfer.items;
    gCurrentFiles = [];
    gMemFsCount = 0;
    gMemFsTotal = 0;
    gMemFsChanged = 0;
    gRootFs = [];
    for(var i=0; i<items.length; i++) {
       walkFileTree(items[i].webkitGetAsEntry());
       gRootFs.push(items[i].webkitGetAsEntry());
    }
  }
// FIXME determine existance of functionality via other methods
  if(browser=='firefox' || me=='web-offline') {     // -- fallback, walkFileTree won't work with file://
    if(evt.dataTransfer.files.length>0) {
      gCurrentFiles = [];                              // -- be aware: gCurrentFiles = evt.dataTransfer.files won't work, as rewriting file will mess up the array
      for(var i=0; i<evt.dataTransfer.files.length; i++) {
        gCurrentFiles.push(evt.dataTransfer.files[i]);  // -- need to transfer the single elements
      }
      loadLocalFiles();
    } else {
      throw new Error("Please drop a single jscad, scad, stl file, or multiple jscad files");
    }
  }
};

// this is the core of the drag'n'drop:
//    1) walk the tree
//    2) read the files (readFileAsync)
//    3) re-render if there was a change (via readFileAsync)
function walkFileTree(item,path) {
 path = path||"";
 //console.log("item=",item);
 if(item.isFile) {
   item.file(function(file) {                // this is also asynchronous ... (making everything complicate)
     if(file.name.match(/\.(jscad|js|scad|obj|stl|amf|gcode)$/)) {   // FIXME now all files OpenJSCAD can handle
       console.log("walkFileTree File: "+path+item.name);
       gMemFsTotal++;
       gCurrentFiles.push(file);
       readFileAsync(file);
     }
   });
  } else if(item.isDirectory) {
    var dirReader = item.createReader();
    console.log("walkFileTree Folder: "+item.name);
    dirReader.readEntries(function(entries) {
      // console.log("===",entries,entries.length);
      for(var i=0; i<entries.length; i++) {
        //console.log(i,entries[i]);
        walkFileTree(entries[i],path+item.name+"/");
      }
    });
  }
};

// this is the linear drag'n'drop, a list of files to read (when folders aren't supported)
function loadLocalFiles() {
  var items = gCurrentFiles;
  console.log("loadLocalFiles",items);
  gMemFsCount = 0;
  gMemFsTotal = items.length;
  gMemFsChanged = 0;

  for(var i=0; i<items.length; i++) {
    var f = items[i];
    console.log(f);
    readFileAsync(f);
  }
};

// set one file (the one dragged) or main.jscad
function setCurrentFile(file) {
  gCurrentFile = file;

  console.log("execute: "+file.name);
  if(file.name.match(/\.(jscad|js|scad|stl|obj|amf|gcode)$/i)) { // FIXME where is the list?
    gCurrentFile.lang = RegExp.$1;
  } else {
    throw new Error("Please drop a file with .jscad, .scad or .stl extension");
  }
  if(file.size == 0) {
    throw new Error("You have dropped an empty file");
  }
  fileChanged(file);
};

// RANT: JavaScript at its finest: 50 lines code to read a SINGLE file
//       this code looks complicate and it is complicate.
function readFileAsync(f) {
  console.log("request: "+f.name+" ("+f.fullPath+")");

  var reader = new FileReader();
  reader.onloadend = function(evt) {
    if(evt.target.readyState == FileReader.DONE) {
      var source = evt.target.result;

      console.log("done reading: "+f.name,source?source.length:0);   // it could have been vanished while fetching (race condition)
      gMemFsCount++;

     // note: assigning f.source = source too make gMemFs[].source the same, therefore as next
      if(!gMemFs[f.name]||gMemFs[f.name].source!=source)
        gMemFsChanged++;

      f.source = source;                 // -- do it after comparing

      gMemFs[f.name] = f;                // -- we cache the file (and its actual content)

      if(gMemFsCount==gMemFsTotal) {                // -- are we done reading all?
        console.log("all "+gMemFsTotal+" files read.");
        if(gMemFsTotal>1||gMemFsCount>1) {         // we deal with multiple files, so we hide the editor to avoid confusion
          $('#editor').hide();
        } else {
          $('#editor').show();
        }

        if(gMemFsTotal>1) {
          if(gMemFs['main.jscad']) {
            gMainFile = gMemFs['main.jscad'];
          } else if(gMemFs['main.js']) {
            gMainFile = gMemFs['main.js'];
          } else {
            for(var fn in gMemFs) {
              if(gMemFs[fn].name.match(/\/main.jscad$/)||gMemFs[fn].name.match(/\/main.js$/)) {
                gMainFile = gMemFs[fn];
              }
            }
          }
        } else {
          gMainFile = f;
        }
        if(gMemFsChanged>0) {
          if(!gMainFile)
            throw("No main.jscad found");
            console.log("update & redraw "+gMainFile.name);
            setCurrentFile(gMainFile);
         }
      }
    } else {
      throw new Error("Failed to read file");
      if(gProcessor) gProcessor.clearViewer();
        previousScript = null;
    }
  };

  if(f.name.match(/\.(stl|gcode)$/)) { // FIXME how to determine?
    reader.readAsBinaryString(f,"UTF-8");
  } else {
    reader.readAsText(f,"UTF-8");
  }
};

// update the dropzone visual & call the main parser
function fileChanged(f) {
  var dropZone = document.getElementById('filedropzone');
  gCurrentFile = f;
  if(gCurrentFile) {
    var txt;
    if(gMemFsTotal>1) {
      txt = "Current file: "+gCurrentFile.name+" (+ "+(gMemFsTotal-1)+" more files)";
    } else {
      txt = "Current file: "+gCurrentFile.name;
    }
    document.getElementById("currentfile").innerHTML = txt;
    document.getElementById("filedropzone_filled").style.display = "block";
    document.getElementById("filedropzone_empty").style.display = "none";
  } else {
    document.getElementById("filedropzone_filled").style.display = "none";
    document.getElementById("filedropzone_empty").style.display = "block";
  }
  parseFile(f,false,false);
};

// check if there were changes: (re-)load all files and check if content was changed
function superviseAllFiles(p) {
  console.log("superviseAllFiles()");

  gMemFsCount = gMemFsTotal = 0;
  gMemFsChanged = 0;

  if(p&&p.forceReload)
    gMemFsChanged++;

  if(!gRootFs||gRootFs.length==0||me=='web-offline') {              // walkFileTree won't work with file:// (regardless of chrome|firefox)
    for(var i=0; i<gCurrentFiles.length; i++) {
      console.log("[offline] checking "+gCurrentFiles[i].name);
      gMemFsTotal++;
      readFileAsync(gCurrentFiles[i]);
    }
  } else {
    for(var i=0; i<gRootFs.length; i++) {
      walkFileTree(gRootFs[i]);
    }
  }
};

var previousScript = null;

// parse the file (and convert) to a renderable source (jscad)
function parseFile(f, debugging, onlyifchanged) {
  if(arguments.length==2) {
    debugging = arguments[1];
    onlyifchanged = arguments[2];
    f = gCurrentFile;
  }
  //gCurrentFile = f;
  var source = f.source;
  var editorSource = source;

  if(source == "") {
    if(document.location.toString().match(/^file\:\//i)) {
      throw new Error("Could not read file. You are using a local copy of OpenJSCAD.org; if you are using Chrome, you need to launch it with the following command line option:\n\n--allow-file-access-from-files\n\notherwise the browser will not have access to uploaded files due to security restrictions.");
    }
    throw new Error("Could not read file.");
  }

  if(gProcessor && ((!onlyifchanged) || (previousScript !== source))) {
    var fn = gCurrentFile.name;
    fn = fn.replace(/^.*\/([^\/]*)$/,"$1");     // remove path, leave filename itself
    gProcessor.setDebugging(debugging);
    var asyncComputation = false;

    if(gCurrentFile.lang=='jscad'||gCurrentFile.lang=='js') {
      ; // default
    } else if(gCurrentFile.lang=='scad') {
      if(!editorSource.match(/^\/\/!OpenSCAD/i)) {
        editorSource = "//!OpenSCAD\n"+editorSource;
      }
      source = openscadOpenJscadParser.parse(editorSource);
      editor.getSession().setMode("ace/mode/scad");

    } else if(gCurrentFile.lang.match(/(stl|obj|amf|gcode)/i)) {
      status("Converting "+fn+" <img id=busy src='imgs/busy.gif'>");
      if(!fn.match(/amf/i)) {     // -- if you debug the STL parsing, change it to 'if(0&&...' so echo() works, otherwise in workers
                                  //    echo() is not working.., and parseAMF requires jquery, which seem not working in workers
        var blobURL = new Blob([document.querySelector('#conversionWorker').textContent]);
        // -- the messy part coming here:
        var worker = new Worker(window.webkitURL!==undefined?window.webkitURL.createObjectURL(blobURL):window.URL.createObjectURL(blobURL));
        worker.onmessage = function(e) {
          var data = e.data;
          if(data&&data.source&&data.source.length) {              // end of async conversion
            putSourceInEditor(data.source,data.filename);
            gMemFs[data.filename].source = data.source;
            gProcessor.setJsCad(data.source,data.filename);
          } else {
            // worker responds gibberish
          }
        };
        var u = document.location.href;
        u = u.replace(/#.*$/,'');
        u = u.replace(/\?.*$/,'');
        worker.postMessage({me: me, version: version, url: u, source: source, filename: fn });
        asyncComputation = true;
      } else {
        fn.match(/\.(stl|obj|amf|gcode)$/i);
        var type = RegExp.$1;
        if(type=='obj') {
          editorSource = source = parseOBJ(source,fn);
        } else if(type=='amf') {
          editorSource = source = parseAMF(source,fn);
        } else if(type=='gcode') {
          editorSource = source = parseGCode(source,fn);
        } else {
          editorSource = source = parseSTL(source,fn);
        }
      }
    } else {
      throw new Error("Please drop a file with .jscad, .scad or .stl extension");
    }
    if(!asyncComputation) {                   // end of synchronous conversion
      putSourceInEditor(editorSource,fn);
      gMemFs[fn].source = source;
      gProcessor.setJsCad(source,fn);
    }
  }
};

