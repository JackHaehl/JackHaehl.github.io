document.querySelectorAll('.filters button').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.filters button').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    var f = btn.getAttribute('data-filter');
    document.querySelectorAll('.story').forEach(function(card){
      var cats = (card.getAttribute('data-cat') || '').split(' ');
      card.style.display = (f === 'all' || cats.indexOf(f) !== -1) ? '' : 'none';
    });
  });
});
var topBtn = document.getElementById('totop');
if (topBtn) {
  window.addEventListener('scroll', function(){ topBtn.style.display = window.scrollY > 600 ? 'block' : 'none'; });
  topBtn.addEventListener('click', function(){ window.scrollTo({top: 0, behavior: 'smooth'}); });
}
