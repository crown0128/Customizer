import $ from 'jquery'

import { setUpEditor } from './editor'
import { setupDragDrop } from './drag-drop'

import { detectBrowser } from './detectBrowser'
import { getUrlParams } from './urlHelpers'
import { createExamples, fetchExample, loadInitialExample } from './examples'
import { createOptions, getOptions } from './options'
import AlertUserOfUncaughtExceptions from './errorDispatcher'

import { version } from '../jscad/version'
import Processor from '../jscad/processor'

const me = document.location.toString().match(/^file:/) ? 'web-offline' : 'web-online'
const browser = detectBrowser()

var showEditor = true
var remoteUrl = './remote.pl?url='
// var remoteUrl = './remote.php?url='
var gProcessor = null
var gEditor = null

var gMemFs = [] // associated array, contains file content in source gMemFs[i].{name,source}
var gCurrentFiles = [] // linear array, contains files (to read)

function init () {
  // Show all exceptions to the user: // WARNING !! this is not practical at dev time
  AlertUserOfUncaughtExceptions()

  getUrlParams(document.URL)

  gProcessor = new Processor(document.getElementById('viewerContext'))
  gEditor = setUpEditor(undefined, gProcessor)
  setupDragDrop()
  createExamples(me)
  createOptions()
  getOptions()

  loadInitialExample(me, {gMemFs, gProcessor, gEditor})

  $('#menu').height($(window).height()) // initial height

  $('#editFrame').height($(window).height())
  $(window).resize(function () { // adjust the relevant divs
    $('#menu').height($(window).height())
    $('#menuHandle').css({top: '45%'})
    $('#editFrame').height($(window).height())
  })
  setTimeout(function () {$('#menu').css('left', '-280px')}, 3000) // -- hide slide-menu after 3secs

  $('#menu').mouseleave(function () {
    $('#examples').css('height', 0); $('#examples').hide()
    $('#options').css('height', 0); $('#options').hide()
  })

  $('#editHandle').click(function () {
    if ($('#editFrame').width() === 0) {
      $('#editFrame').css('width', '40%')
      $('#editHandle').attr('src', 'imgs/editHandleIn.png')
    } else {
      $('#editFrame').css('width', '0px')
      $('#editHandle').attr('src', 'imgs/editHandleOut.png')
    }
  })

  // -- Examples
  $('#examplesTitle').click(function () {
    $('#examples').css('height', 'auto')
    $('#examples').show()
    $('#options').css('height', 0)
    $('#options').hide()
  })
  $('#examples').mouseleave(function () {
    $('#examples').css('height', 0)
    $('#examples').hide()
  })

  function onLoadExampleClicked (e) {
    if (showEditor) { // FIXME test for the element
      $('#editor').show()
    } else {
      $('#editor').hide()
    }
    const examplePath = e.currentTarget.dataset.path
    fetchExample(examplePath, undefined, {gMemFs, gProcessor, gEditor})
  }
  document.querySelectorAll('.example')
    .forEach(function (element) {
      element.addEventListener('click', onLoadExampleClicked)
    })

  // -- Options
  $('#optionsTitle').click(function () {
    $('#options').css('height', 'auto')
    $('#options').show()
    $('#examples').css('height', 0)
    $('#examples').hide()
  })
  $('#options').mouseleave(function () {
    $('#options').css('height', 0)
    $('#options').hide()
  })
  // $('#optionsForm').submit(function() {
  //   // save to cookie
  //   $('#optionsForm').hide()
  //   return false
  // })
  $('#optionsForm').change(function () {
    // save to cookie
    saveOptions()
  })

  $('#plate').change(function () {
    if ($('#plate').val() == 'custom') {
      $('#customPlate').show()
    } else {
      $('#customPlate').hide()
    }
  })

  // about/ licence section
  $('.navlink.about').click(function (e) {
    $('#about').show()
    return false
  })
  $('.okButton').click(function (e) {
    $('#about').hide(); return false
  })

  // dropzone
  const dropZoneText = browser === 'chrome' && me === 'web-online' ? ', or folder with jscad files ' : ''
  document.querySelector('#filedropzone_empty')
    .innerHTML =
    `Drop one or more supported files
       ${dropZoneText}
       here (see <a style='font-weight: normal' href='https://github.com/Spiritdude/OpenJSCAD.org/wiki/User-Guide#support-of-include' target=_blank>details</a>)
       <br>or directly edit OpenJSCAD or OpenSCAD code using the editor.`

  document.querySelector('#reloadAllFiles').onclick = reloadAllFiles

  // version number displays
  const footerContent = `OpenJSCAD.org ${version}, MIT License, get your own copy/clone/fork from <a target=_blank href="https://github.com/Spiritdude/OpenJSCAD.org">GitHub: OpenJSCAD</a>`
  document.querySelector('#footer').innerHTML = footerContent

  const versionText = `Version ${version}`
  document.querySelector('#menuVersion').innerHTML = versionText
  document.querySelector('#aboutVersion').innerHTML = versionText
}

document.addEventListener('DOMContentLoaded', function (event) {
  init()
})
