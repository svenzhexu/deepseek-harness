/* Cordis 学习指南 — 共享脚本：导航、目录、复制、语法着色、阅读进度 */
(function () {
  'use strict'

  var CHAPTERS = [
    { id: 'index', file: 'index.html', num: '00', title: '学习指南', part: '开始', desc: '课程地图与阅读路线' },
    { id: '01', file: '01-what-is-cordis.html', num: '01', title: '什么是 Cordis', part: '第一篇 · 认识', desc: '从 main 函数到插件树' },
    { id: '02', file: '02-why-cordis.html', num: '02', title: '为什么需要 Cordis', part: '第一篇 · 认识', desc: '六个痛点，与它的答案和代价' },
    { id: '03', file: '03-mental-model.html', num: '03', title: '一张图看懂 Cordis', part: '第一篇 · 认识', desc: '架构、生命周期与包地图' },
    { id: '04', file: '04-context.html', num: '04', title: 'Context：能力面板', part: '第二篇 · 核心概念', desc: '服务容器、作用域与隔离' },
    { id: '05', file: '05-plugin-fiber.html', num: '05', title: '插件与 Fiber', part: '第二篇 · 核心概念', desc: '可插拔实例与它的生命周期' },
    { id: '06', file: '06-service.html', num: '06', title: '服务：按名字使用能力', part: '第二篇 · 核心概念', desc: '声明能力，而不是导入实现' },
    { id: '07', file: '07-events.html', num: '07', title: '事件：互不相识也能协作', part: '第二篇 · 核心概念', desc: '五种分发模式与 waterfall' },
    { id: '08', file: '08-effect.html', num: '08', title: 'Effect：注册即可撤销', part: '第二篇 · 核心概念', desc: '资源回收与卸载顺序' },
    { id: '09', file: '09-config-loader.html', num: '09', title: '配置与 Loader', part: '第三篇 · 组装应用', desc: '用文件而不是代码组装应用' },
    { id: '10', file: '10-diy-comparison.html', num: '10', title: '与手写 main 的异同', part: '第四篇 · 对照与实战', desc: '八十行迷你框架的对照' },
    { id: '11', file: '11-build-your-app.html', num: '11', title: '实战：开发自己的程序', part: '第四篇 · 对照与实战', desc: '从零写一个可用的待办 CLI' },
    { id: '12', file: '12-cheatsheet.html', num: '12', title: '速查表与排错手册', part: '第五篇 · 附录', desc: 'API、错误、术语与练习' }
  ]

  var contentChapters = CHAPTERS.filter(function (c) { return c.id !== 'index' })

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  function currentChapter() {
    var id = document.body.getAttribute('data-page') || 'index'
    for (var i = 0; i < CHAPTERS.length; i++) {
      if (CHAPTERS[i].id === id) return CHAPTERS[i]
    }
    return CHAPTERS[0]
  }

  /* ---------------------------------------------------------------- 侧栏 */
  function initNav() {
    var nav = document.getElementById('site-nav')
    if (!nav) return
    var current = currentChapter()
    var parts = []
    CHAPTERS.forEach(function (chapter) {
      if (parts.indexOf(chapter.part) === -1) parts.push(chapter.part)
    })
    parts.forEach(function (part) {
      nav.appendChild(el('div', 'nav-part', part))
      CHAPTERS.forEach(function (chapter) {
        if (chapter.part !== part) return
        var link = document.createElement('a')
        link.href = chapter.file
        link.appendChild(el('span', 'num', chapter.num))
        link.appendChild(el('span', 'nav-title', chapter.title))
        if (chapter.id === current.id) {
          link.className = 'active'
          link.setAttribute('aria-current', 'page')
        }
        nav.appendChild(link)
      })
    })

    var indicator = document.getElementById('chapter-indicator')
    if (indicator) {
      if (current.id === 'index') {
        indicator.textContent = '开始 · 共 ' + contentChapters.length + ' 章'
      } else {
        var number = 0
        contentChapters.forEach(function (chapter, index) {
          if (chapter.id === current.id) number = index + 1
        })
        indicator.textContent = '第 ' + number + ' / ' + contentChapters.length + ' 章'
      }
    }

    var topbar = document.querySelector('.topbar')
    if (topbar && !topbar.querySelector('.topbar-crumb')) {
      var crumbText = current.id === 'index'
        ? '零基础 · 从 main 到插件树'
        : '第 ' + current.num + ' 章 · ' + current.title
      var crumb = el('span', 'topbar-crumb', crumbText)
      topbar.insertBefore(crumb, topbar.firstChild)
    }
  }

  /* ---------------------------------------------------------------- 翻页 */
  function initPager() {
    var pager = document.getElementById('pager')
    if (!pager) return
    var current = currentChapter()
    var index = -1
    CHAPTERS.forEach(function (chapter, i) {
      if (chapter.id === current.id) index = i
    })
    if (index === -1) return

    var prev = CHAPTERS[index - 1]
    var next = CHAPTERS[index + 1]
    pager.textContent = ''

    if (prev) {
      var prevLink = document.createElement('a')
      prevLink.href = prev.file
      prevLink.className = 'prev'
      prevLink.appendChild(el('span', 'dir', '← 上一篇'))
      prevLink.appendChild(el('span', 'ttl', prev.title))
      pager.appendChild(prevLink)
    } else {
      pager.appendChild(el('span', '', ''))
    }

    if (next) {
      var nextLink = document.createElement('a')
      nextLink.href = next.file
      nextLink.className = 'next'
      nextLink.appendChild(el('span', 'dir', '下一篇 →'))
      nextLink.appendChild(el('span', 'ttl', next.title))
      pager.appendChild(nextLink)
    }
  }

  /* ---------------------------------------------------------------- 移动端菜单 */
  function initMenu() {
    var button = document.getElementById('menu-btn')
    var sidebar = document.getElementById('sidebar')
    var backdrop = document.getElementById('sidebar-backdrop')
    if (!button || !sidebar || !backdrop) return

    function close() {
      sidebar.classList.remove('open')
      backdrop.classList.remove('open')
      button.setAttribute('aria-expanded', 'false')
    }
    function toggle() {
      var open = !sidebar.classList.contains('open')
      sidebar.classList.toggle('open', open)
      backdrop.classList.toggle('open', open)
      button.setAttribute('aria-expanded', String(open))
    }

    button.addEventListener('click', toggle)
    backdrop.addEventListener('click', close)
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a')) close()
    })
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close()
    })
  }

  /* ---------------------------------------------------------------- 本章目录 */
  function initToc() {
    var list = document.getElementById('toc-list')
    var toc = document.getElementById('toc')
    if (!list || !toc) return
    var headings = Array.prototype.slice.call(document.querySelectorAll('#main h2'))
    if (headings.length < 2) {
      toc.style.display = 'none'
      return
    }
    headings.forEach(function (heading, index) {
      if (!heading.id) heading.id = 'section-' + (index + 1)
      var item = document.createElement('li')
      var link = document.createElement('a')
      link.href = '#' + heading.id
      link.textContent = heading.textContent
      item.appendChild(link)
      list.appendChild(item)
    })
  }

  /* ---------------------------------------------------------------- 滚动效果 */
  function initScroll() {
    var progress = document.getElementById('reading-progress')
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('#toc-list a'))
    var headings = tocLinks.map(function (link) {
      return document.getElementById(link.getAttribute('href').slice(1))
    })
    var ticking = false

    function update() {
      ticking = false
      var doc = document.documentElement
      var max = doc.scrollHeight - window.innerHeight
      var ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      if (progress) progress.style.width = (ratio * 100).toFixed(2) + '%'

      if (!headings.length) return
      var active = 0
      for (var i = 0; i < headings.length; i++) {
        if (headings[i] && headings[i].getBoundingClientRect().top <= 140) active = i
      }
      tocLinks.forEach(function (link, index) {
        link.classList.toggle('active', index === active)
      })
    }

    function onScroll() {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
  }

  /* ---------------------------------------------------------------- 代码复制 */
  function initCopy() {
    var cards = document.querySelectorAll('.code-card')
    Array.prototype.forEach.call(cards, function (card) {
      var head = card.querySelector('.code-head')
      var code = card.querySelector('pre code')
      if (!head || !code || head.querySelector('.copy-btn')) return
      if (card.classList.contains('output')) return

      var button = document.createElement('button')
      button.type = 'button'
      button.className = 'copy-btn'
      button.textContent = '复制'
      button.setAttribute('aria-label', '复制这段代码')

      button.addEventListener('click', function () {
        var text = code.textContent || ''
        function done() {
          button.textContent = '已复制'
          button.classList.add('done')
          window.setTimeout(function () {
            button.textContent = '复制'
            button.classList.remove('done')
          }, 1600)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback)
        } else {
          fallback()
        }
        function fallback() {
          var area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', '')
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          try { document.execCommand('copy'); done() } catch (error) { /* 复制失败时保持原按钮 */ }
          document.body.removeChild(area)
        }
      })

      head.appendChild(button)
    })
  }

  /* ---------------------------------------------------------------- 语法着色 */
  var KEYWORDS = {};
  ('import from export default const let var function class extends new return if else for of in while do switch case break continue ' +
    'await async interface type declare module namespace implements public private protected readonly static true false null undefined ' +
    'void this super throw try catch finally yield as satisfies keyof typeof instanceof enum').split(' ').forEach(function (word) {
    KEYWORDS[word] = true
  })

  function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function highlight(source, lang) {
    var escaped = escapeHtml(source)
    if (!/^(ts|tsx|js|jsx|json|ya?ml)$/i.test(lang)) return escaped

    var pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g
    return escaped.replace(pattern, function (token) {
      var first = token.charAt(0)
      if (token.indexOf('//') === 0 || token.indexOf('/*') === 0 || first === '#') {
        return '<span class="tok-com">' + token + '</span>'
      }
      if (first === '"' || first === "'" || first === '`') {
        return '<span class="tok-str">' + token + '</span>'
      }
      if (/^\d/.test(token)) {
        return '<span class="tok-num">' + token + '</span>'
      }
      if (KEYWORDS[token]) {
        return '<span class="tok-kw">' + token + '</span>'
      }
      return token
    })
  }

  function initHighlight() {
    var blocks = document.querySelectorAll('.code-card pre code')
    Array.prototype.forEach.call(blocks, function (block) {
      if (block.getAttribute('data-highlighted')) return
      var className = block.className || ''
      var match = className.match(/language-([\w-]+)/)
      if (!match) return
      var source = block.textContent || ''
      block.innerHTML = highlight(source, match[1])
      block.setAttribute('data-highlighted', 'true')
    })
  }

  /* ---------------------------------------------------------------- 启动 */
  try { initNav() } catch (error) { /* 导航失败不应影响阅读 */ }
  try { initPager() } catch (error) { /* 同上 */ }
  try { initMenu() } catch (error) { /* 同上 */ }
  try { initToc() } catch (error) { /* 同上 */ }
  try { initHighlight() } catch (error) { /* 着色失败时保留纯文本 */ }
  try { initCopy() } catch (error) { /* 复制失败不影响阅读 */ }
  try { initScroll() } catch (error) { /* 滚动增强失败不影响阅读 */ }
})()
