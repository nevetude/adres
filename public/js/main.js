(function() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.style.backgroundColor = savedTheme === 'dark' ? '#121212' : '#ffffff';
  })();
  
  document.addEventListener('DOMContentLoaded', function() {
      const themeToggle = document.getElementById('themeToggle');
      const currentTheme = localStorage.getItem('theme') || 'light';
      
      function applyTheme(theme) {
          const html = document.documentElement;
          html.setAttribute('data-theme', theme);
          html.style.backgroundColor = theme === 'dark' ? '#121212' : '#ffffff';
          
          if (theme === 'dark') {
              themeToggle.innerHTML = '<i class="bi bi-sun-fill"></i>';
              document.querySelector('.navbar').classList.add('navbar-dark', 'bg-dark');
          } else {
              themeToggle.innerHTML = '<i class="bi bi-moon-fill"></i>';
              document.querySelector('.navbar').classList.add('navbar-dark', 'bg-dark');
          }
      }
  
      // Инициализация темы
      applyTheme(currentTheme);
  
      themeToggle.addEventListener('click', function() {
          const newTheme = document.documentElement.getAttribute('data-theme') !== 'dark' ? 'dark' : 'light';
          localStorage.setItem('theme', newTheme);
          applyTheme(newTheme);
      });
  
      // Инициализация всплывающих подсказок
      const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
      tooltipTriggerList.map(function (tooltipTriggerEl) {
          return new bootstrap.Tooltip(tooltipTriggerEl);
      });
  });