import content from '@/data/content.json'

// Общий футер для каталога и страниц проекта: кратко об архиве,
// навигация, разделы и авторы. Тексты лежат в content.json (блок footer).
export function SiteFooter() {
  const f = content.footer

  // Авторы: имена вписываются в content.json (footer.authors, до 4 человек).
  // Пустые имена не выводятся, как в блоке credits.
  const authors = (Array.isArray(f.authors) ? f.authors : []).filter(
    (author) => author.name?.trim(),
  )

  // Разработчики сайта: имена вписываются в content.json (footer.developers).
  const developers = (Array.isArray(f.developers) ? f.developers : []).filter(
    (dev) => dev.name?.trim(),
  )

  return (
    <footer className="mt-16 border-t border-stone-line bg-stone-deep">
      <div className="shell grid gap-10 py-12 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {/* О проекте */}
        <div className="max-w-[38ch]">
          <a href="#/" className="inline-flex items-center gap-2 text-graphite" aria-label={content.project.title}>
            <span className="text-lg text-accent" aria-hidden="true">
              {content.project.mark}
            </span>
            <span className="display-title text-lg">
              {content.project.shortTitle}
            </span>
          </a>
          <p className="mt-3 text-sm leading-relaxed text-graphite-soft">
            {f.about}
          </p>
        </div>

        {/* Навигация */}
        <nav aria-label={f.navTitle} className="flex flex-col gap-3">
          <h2 className="kicker text-graphite-muted">{f.navTitle}</h2>
          <ul className="flex flex-col gap-2">
            {content.nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-graphite-soft transition-colors hover:text-accent"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#/create-project"
                className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors hover:text-accent-strong"
              >
                {f.participate} <span aria-hidden="true">→</span>
              </a>
            </li>
          </ul>
        </nav>

        {/* Разделы архива ведут в каталог с фильтром */}
        <nav aria-label={f.sectionsTitle} className="flex flex-col gap-3">
          <h2 className="kicker text-graphite-muted">{f.sectionsTitle}</h2>
          <ul className="flex flex-col gap-2">
            {content.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#/catalog?section=${section.id}`}
                  className="inline-flex items-center gap-2 text-sm text-graphite-soft transition-colors hover:text-accent"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Авторы проекта: столбик появляется, когда вписано хотя бы одно имя */}
        {authors.length > 0 && (
          <div aria-label={f.authorsTitle} className="flex flex-col gap-3">
            <h2 className="kicker text-graphite-muted">{f.authorsTitle}</h2>
            <ul className="flex flex-col gap-2">
              {authors.map((author) => (
                <li key={author.name} className="text-sm font-semibold text-graphite">
                  {author.name}
                  {author.role && <span className="block text-xs font-normal text-graphite-muted">{author.role}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Разработчики сайта: столбик появляется, когда вписано хотя бы одно имя */}
        {developers.length > 0 && (
          <div aria-label={f.developersTitle} className="flex flex-col gap-3">
            <h2 className="kicker text-graphite-muted">{f.developersTitle}</h2>
            <ul className="flex flex-col gap-2">
              {developers.map((dev) => (
                <li key={dev.name} className="text-sm font-semibold text-graphite">
                  {dev.name}
                  {dev.role && <span className="block text-xs font-normal text-graphite-muted">{dev.role}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Нижняя строка: примечание о проверке материалов и лицензия */}
      <div className="border-t border-stone-line">
        <div className="shell py-5 text-xs text-graphite-muted">
          <p className="mt-2 flex items-center gap-1.5">
            <span aria-hidden="true">©</span>
            <a
              href={f.license.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-accent transition-colors hover:text-accent-strong"
            >
              {f.license.label}
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
