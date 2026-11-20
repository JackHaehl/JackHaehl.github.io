var active = new Set();
var searchBox = document.getElementById('search');
var noResults = document.getElementById('noresults');
function applyFilters(){
  var q = (searchBox ? searchBox.value.toLowerCase() : '');
  var shown = 0;
  document.querySelectorAll('.grid .card').forEach(function(card){
    var cats = (card.getAttribute('data-cat') || '').split(' ');
    var title = (card.getAttribute('data-title') || '');
    var tagOk = active.size === 0 || cats.some(function(c){ return active.has(c); });
    var textOk = !q || title.indexOf(q) !== -1;
    var show = tagOk && textOk;
    card.style.display = show ? '' : 'none';
    if (show) shown += 1;
  });
  if (noResults) noResults.style.display = shown === 0 ? 'block' : 'none';
}
document.querySelectorAll('.controls button[data-tag]').forEach(function(btn){
  btn.addEventListener('click', function(){
    var tag = btn.getAttribute('data-tag');
    if (active.has(tag)) { active.delete(tag); btn.classList.remove('active'); }
    else { active.add(tag); btn.classList.add('active'); }
    applyFilters();
  });
});
document.querySelectorAll('.controls button[data-clear]').forEach(function(btn){
  btn.addEventListener('click', function(){
    active.clear();
    document.querySelectorAll('.controls button[data-tag]').forEach(function(b){ b.classList.remove('active'); });
    if (searchBox) searchBox.value = '';
    applyFilters();
  });
});
if (searchBox) searchBox.addEventListener('input', applyFilters);
