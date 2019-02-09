const most = require('most')

function makeReactions (inputs) {
  const { sinks, sources, outputs$, extras } = inputs
  const { store, fs, http, i18n, dom, solidWorker, state, dat } = sinks

  /* outputs$
    .filter(x => 'sink' in x && x.sink === 'dom')
    .forEach(x => console.log(' out to dom', x))
  outputs$
    .filter(x => 'sink' in x && x.sink === 'state')
    .forEach(x => console.log(' out to state', x))

  outputs$
    .filter(x => 'sink' in x && x.sink === 'i18n')
    .forEach(x => console.log(' out to i18n', x))

  outputs$
    .filter(x => 'sink' in x && x.sink === 'store')
    .forEach(x => console.log(' out to store', x))
  outputs$
    .filter(x => 'sink' in x && x.sink === 'fs')
    .forEach(x => console.log(' out to fs', x)) */

  // output to dom
  dom(require('./dom')(inputs))
  // output to i18n
  i18n(outputs$.filter(x => 'sink' in x && x.sink === 'i18n'))
  // output to storage
  store(outputs$.filter(x => 'sink' in x && x.sink === 'store'))
  // output to http
  http(outputs$.filter(x => 'sink' in x && x.sink === 'http'))
  // data out to file system sink
  // drag & drops of files/folders have DUAL meaning:
  // * ADD this file/folder to the available ones
  // * OPEN this file/folder
  fs(outputs$.filter(x => 'sink' in x && x.sink === 'fs'))
  // web worker sink
  solidWorker(outputs$.filter(x => 'sink' in x && x.sink === 'geometryWorker'))
  // state sink
  state(outputs$.filter(x => 'sink' in x && x.sink === 'state'))

  dat(outputs$.filter(x => 'sink' in x && x.sink === 'dat'))

  // viewer data
  const makeCsgViewer = require('@jscad/csg-viewer')
  let csgViewer
  const jscadEl = extras.jscadEl
  sources.state
    .filter(state => state.design && state.design.mainPath !== '')
    .skipRepeatsWith(function (state, previousState) {
      const sameSolids = state.design.solids.length === previousState.design.solids.length &&
      JSON.stringify(state.design.solids) === JSON.stringify(previousState.design.solids)
      return sameSolids
    })
    .forEach(state => {
      if (csgViewer !== undefined) {
        csgViewer(undefined, { solids: state.design.solids })
      }
    })

  outputs$.filter(x => 'sink' in x && x.sink === 'viewer')
    .forEach(x => {
      console.log('viewer', x)
      if (csgViewer) {
        csgViewer({ camera: { projectionType: x.data } })
      }
    })
  sources.state
    .map(state => state.viewer)
  // FIXME: not working correctly with themeing
  /* .skipRepeatsWith(function (state, previousState) {
    const sameViewerParams = JSON.stringify(state) === JSON.stringify(previousState)
    return sameViewerParams
  }) */
    .forEach(params => {
      const viewerElement = jscadEl.querySelector('#renderTarget')
      // initialize viewer if it has not been done already
      if (viewerElement && !csgViewer) {
        const csgViewerItems = makeCsgViewer(viewerElement, params)
        csgViewer = csgViewerItems.csgViewer
      // const bar = require('most-gestures').pointerGestures(jscadEl.querySelector('#renderTarget'))
      }
      if (csgViewer) {
      // console.log('params', params)
        csgViewer(params)
      }
    })

  // titlebar & store side effects
  // FIXME/ not compatible with multiple instances !!
  /* titleBar.sink(
    state.map(state => state.appTitle).skipRepeats()
  ) */
}

module.exports = makeReactions
