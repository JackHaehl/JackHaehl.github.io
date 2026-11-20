document.querySelectorAll('.filters button').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.filters button').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    var f = btn.getAttribute('data-filter');
    document.querySelectorAll('.grid .card').forEach(function(card){
      var cats = (card.getAttribute('data-cat') || '').split(' ');
      card.style.display = (f === 'all' || cats.indexOf(f) !== -1) ? '' : 'none';
    });
  });
});
