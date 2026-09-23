import {groupProducts} from './product-groups.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const key=value=>String(value??'').trim().toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ');
export function mountGroupEditor(container,products){
  function render(){
    container.innerHTML=`<section class="group-review"><h3>Группы по названиям товаров</h3><p class="fine-print">Проверьте предложенные группы и подгруппы. В поле группы можно выбрать существующую или написать новую. Одинаковые названия объединяются. Пустая подгруппа допустима.</p><div data-group-summary aria-live="polite"></div><details><summary>Переименовать целую группу</summary><div data-group-renames></div></details><datalist id="import-group-names"></datalist><datalist id="import-subgroup-names"></datalist><details open><summary>Проверить товары и изменить распределение</summary><div class="group-editor-products">${products.map((p,i)=>`<article class="group-editor-product"><strong>${esc(p.name)}</strong><small class="muted">Артикул ${esc(p.sku)}${p.groupingNeedsReview?' · Проверьте распределение':''}</small><p class="fine-print">${esc(p.groupingNote||'')}</p><div class="form-grid"><label class="field">Группа<input data-product-group="${esc(p.id)}" data-index="${i}" list="import-group-names" required maxlength="80" value="${esc(p.group)}"></label><label class="field">Подгруппа<input data-product-subgroup="${esc(p.id)}" data-index="${i}" list="import-subgroup-names" maxlength="80" value="${esc(p.subgroup)}" placeholder="Без подгруппы"></label></div></article>`).join('')}</div></details></section>`;
    container.querySelectorAll('[data-product-group],[data-product-subgroup]').forEach(input=>{
      input.oninput=()=>{const p=products[Number(input.dataset.index)],field=input.hasAttribute('data-product-group')?'group':'subgroup';p[field]=input.value.trim();summary();};
    });
    summary();
  }
  function summary(){
    const groups=groupProducts(products);
    container.querySelector('[data-group-summary]').innerHTML=`<p class="fine-print">Групп: ${groups.length}</p><div class="group-summary">${groups.map(g=>`<span>${esc(g.name)} · ${g.products.length}${g.subgroups.some(s=>s.name)?`<small>${g.subgroups.map(s=>`${esc(s.name||'Без подгруппы')}: ${s.products.length}`).join(' · ')}</small>`:''}</span>`).join('')}</div>`;
    container.querySelector('#import-group-names').innerHTML=groups.map(g=>`<option value="${esc(g.name)}"></option>`).join('');
    container.querySelector('#import-subgroup-names').innerHTML=[...new Set(products.map(p=>p.subgroup).filter(Boolean))].map(name=>`<option value="${esc(name)}"></option>`).join('');
    const renames=container.querySelector('[data-group-renames]');
    renames.innerHTML=groups.map((g,i)=>`<div class="group-rename"><label class="field">${esc(g.name)} · ${g.products.length}<input data-rename-input="${i}" maxlength="80" value="${esc(g.name)}" aria-label="Новое название ${esc(g.name)}"></label><button type="button" class="secondary" data-rename-group="${i}">Применить</button></div>`).join('');
    renames.querySelectorAll('[data-rename-group]').forEach(button=>button.onclick=()=>{
      const index=Number(button.dataset.renameGroup),input=renames.querySelector(`[data-rename-input="${index}"]`),value=input.value.trim();
      if(!value){input.focus();return;}
      for(const p of products)if(key(p.group)===key(groups[index].name))p.group=value;
      render();
    });
  }
  render();
}
