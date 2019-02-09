const html = require('bel')

module.exports = function options (state, i18n) {
  const languages = state.languages.available.map(language => {
    const selected = state.languages.active === language.code
    return html`<option value='${language.code}' selected=${selected}>${i18n.translate(language.fullName)}</option>`
  })
  const shortcuts = require('./shortcuts')(state, i18n)
  return html`
<section id='options' style='visibility:${state.activeTool === 'options' ? 'visible' : 'hidden'}; color:${state.themes.themeSettings.secondaryTextColor}'>   
  <br>
  <fieldset>
    <legend> <h3> ${i18n`language`}</legend>
    <select id='languageSwitcher'>
      ${languages}  
    </select>
  </fieldset>

  <fieldset>
    <legend> <h3> ${i18n`theme`} </h3> </legend>
    <select id='themeSwitcher'>
      <option value='dark' selected=${state.themes.active === 'dark'}>dark</option>
      <option value='light' selected=${state.themes.active === 'light'}>light</option>
    </select>
  </fieldset>

  <fieldset>
    <legend> <h3> ${i18n`geometry generation`}</h3> </legend>
    <label>${i18n`experimental geometry caching`} ${i18n`see`} <a href='https://github.com/jscad/jscad-desktop#geometry-caching' target="_blank">docs</a>
      <input id='toggleVtreeMode' type='checkbox' checked=${state.design.vtreeMode}/>
    </label>
    <label>${i18n`timeout for solids generation`}
      <input id='solidsTimeout' type='number' min=0 max=200000 value=${state.design.solidsTimeOut} />
    </label>
  </fieldset>

    <fieldset>
      <legend> <h3> ${i18n`3d viewer`} </h3> </legend>  
      <label>${i18n`zoom to fit on new parameters`}
        <input type='checkbox' checked=false id='viewer-zoomtofitonparamschange' disabled />
      </label>
      <label>${i18n`zoom to fit on design load`}
        <input type='checkbox' checked=false id='viewer-zoomtofitonload' disabled />
      </label>
    </fieldset>

    <fieldset>
      <legend> <h3> ${i18n`storage`} </h3> </legend>  
      <label>${i18n`settings storage path`} ${i18n`(not settable)`}
        <input type='text' disabled value='${state.storage.path}' disabled />
      </label>
    </fieldset>

    <section id='shortcuts'>   
      <h3> ${i18n`file handling`} </h3>
      <label>${i18n`convert supported types to jscad script (overwrite main())`}
        <input type='checkbox' checked=false id='design-convertSupportedTypes' checked=${state.design.convertSupportedTypes}/>
      </label>
    </section>

    ${shortcuts}

    
</section>`
}
