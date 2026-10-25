#!/usr/bin/env python3
# Создаёт Word-документ с шаблоном для тестирования приложения.
#
# Расчёт на человека, который не знает проект: короткая инструкция,
# список того, что проверять, и готовые блоки под каждую найденную
# проблему с четырьмя полями — тип, картинка, текущее, ожидаемое.

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

DOC_PATH = "Шаблон_тестирования_приложения.docx"

ACCENT = RGBColor(0xB4, 0x55, 0x2D)   # терракота — как в интерфейсе
GREY = RGBColor(0x6B, 0x65, 0x5D)
DARK = RGBColor(0x2A, 0x27, 0x24)

doc = Document()

# ── Базовые настройки страницы и шрифта ──────────────────────────────
section = doc.sections[0]
section.top_margin = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin = Cm(2.2)
section.right_margin = Cm(2.2)

style = doc.styles["Normal"]
# Arial, а не Calibri: Calibri есть только в Microsoft Office,
# на macOS без него документ отображается системным шрифтом.
# Arial одинаково выглядит везде — и в Word, и в Preview, и в LibreOffice.
style.font.name = "Arial"
style.font.size = Pt(11)
style.font.color.rgb = DARK
# Для кириллицы нужен явный eastAsia-шрифт, иначе Word подставит свой.
style.element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")
style.paragraph_format.space_after = Pt(6)
style.paragraph_format.line_spacing = 1.15


def set_cell_bg(cell, hex_color):
    """Заливка ячейки таблицы."""
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def add_para(text="", bold=False, size=11, color=None, align=None, space_after=6):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = color
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    return p


def add_bullet(text, bold_prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    if bold_prefix:
        r = p.add_run(bold_prefix)
        r.bold = True
    p.add_run(text)
    p.paragraph_format.space_after = Pt(3)
    return p


def add_heading(text, level=1):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = ACCENT if level <= 2 else DARK
        run.font.name = "Arial"
    return h


# ── Титул ────────────────────────────────────────────────────────────
title = doc.add_heading("Отчёт о тестировании приложения", level=0)
for run in title.runs:
    run.font.color.rgb = ACCENT
add_para(
    "Планировщик питания — проверка функционала и внешнего вида",
    size=12, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER,
)

# ── Раздел 1: как пользоваться ───────────────────────────────────────
add_heading("Как пользоваться этим файлом", level=1)

add_para("Спасибо, что помогаешь! Задача простая: пройтись по приложению, "
         "нажимать кнопки и записывать всё, что показалось странным, "
         "неудобным или сломанным. Разбираться в программировании не нужно — "
         "достаточно описать своими словами.", space_after=10)

add_para("Порядок действий:", bold=True, space_after=4)
add_bullet(" — открой ссылку в браузере (Chrome, Safari, любой).", "1")
add_bullet(" — зарегистрируйся или войди, если дали готовый логин.", "2")
add_bullet(" — походи по разделам и попробуй всё, что видишь.", "3")
add_bullet(" — нашёл проблему? Скопируй один блок ниже и заполни его.", "4")

add_para("Сколько блоков копировать — столько, сколько нашёл проблем. "
         "Не нужно искать что-то специально: если всё работает — это тоже "
         "результат, напиши об этом в конце.", space_after=10)

# ── Раздел 2: что проверять ──────────────────────────────────────────
add_heading("Что стоит проверить", level=1)

add_para("Не обязательно проходить всё — начни с того, что интересно. "
         "Ниже подсказки, на что смотреть.", space_after=8)

add_para("Внешний вид", bold=True, space_after=3)
add_bullet("Текст нигде не наезжает друг на друга и не обрезается.")
add_bullet("Надписи на кнопках читаются, кнопки одинаковой высоты.")
add_bullet("Ничего не вылезает за край экрана.")
add_bullet("Понятно ли с первого взгляда, куда нажимать?")

add_para("Логика и поведение", bold=True, space_after=3)
add_bullet("Кнопки делают то, что написано на них.")
add_bullet("Если что-то долго грузится — видно ли, что идёт загрузка?")
add_bullet("Если что-то пошло не так — появляется ли понятное сообщение "
           "об ошибке, или просто ничего не происходит?")
add_bullet("Данные сохраняются после перезагрузки страницы?")
add_bullet("Цифры и расчёты выглядят правдоподобно?")

add_para("Отдельно проверь на телефоне", bold=True, space_after=3)
add_bullet("Удобно ли нажимать кнопки пальцем.")
add_bullet("Ничего не разъезжается на маленьком экране.")

doc.add_page_break()

# ── Раздел 3: шаблон блока ошибки ────────────────────────────────────
add_heading("Шаблон для одной проблемы", level=1)

add_para("Скопируй таблицу ниже столько раз, сколько нашёл проблем, "
         "и заполни. Старайся заполнять все четыре пункта — но если "
         "что-то не знаешь, пропусти, это не страшно.", space_after=10)


def make_issue_block(number, example=False):
    """Рисует один блок проблемы: заголовок + таблица с 4 полями."""

    label = f"Проблема №{number}"
    if example:
        label += "  (пример заполнения — удали его перед отправкой)"

    h = doc.add_heading(label, level=2)
    for run in h.runs:
        run.font.color.rgb = GREY if example else ACCENT

    rows = [
        ("1. Тип", "Дизайн  /  Логика\n\n"
                   "Дизайн — некрасиво, неудобно, непонятно.\n"
                   "Логика — работает не так, как ожидалось, или не работает."),
        ("2. Картинка", "Вставь сюда скриншот: нажми в этой строке и вставь "
                        "картинку (Ctrl+V на Windows, Cmd+V на Mac), "
                        "либо Простая вставка → Рисунок."),
        ("3. Текущее поведение", "Что происходит сейчас? Опиши как есть — "
                                 "своими словами, без технических терминов. "
                                 "Можно по шагам: «нажал сюда → произошло вот это»."),
        ("4. Ожидаемое поведение", "А что должно было произойти, по твоему "
                                   "мнению? Здесь можно пофантазировать — "
                                   "как было бы удобнее."),
    ]

    table = doc.add_table(rows=0, cols=2)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    for name, hint in rows:
        row = table.add_row()
        c0, c1 = row.cells
        c0.width = Cm(4.2)
        c1.width = Cm(12.0)

        p0 = c0.paragraphs[0]
        r0 = p0.add_run(name)
        r0.bold = True
        r0.font.size = Pt(10.5)
        set_cell_bg(c0, "F5F1EA")

        p1 = c1.paragraphs[0]
        r1 = p1.add_run(hint)
        r1.font.size = Pt(10)
        r1.font.color.rgb = GREY
        if name.startswith("2."):
            # Под картинку оставляем место, чтобы было видно, куда вставлять.
            p1.paragraph_format.space_after = Pt(60)
        if name.startswith("3.") or name.startswith("4."):
            p1.paragraph_format.space_after = Pt(28)

    doc.add_paragraph()


# Пустой шаблон
make_issue_block(1)
make_issue_block(2)

doc.add_page_break()

# Пример заполнения — чтобы человек понял, как писать
add_heading("Пример заполнения", level=1)
add_para("Так выглядит заполненный блок. Свой пример удали, "
         "когда будешь писать отчёт.", space_after=10)

h = doc.add_heading("Проблема №0  (это пример)", level=2)
for run in h.runs:
    run.font.color.rgb = GREY

example_rows = [
    ("1. Тип", "Дизайн"),
    ("2. Картинка", "[здесь был бы скриншот экрана «Холодильник»]"),
    ("3. Текущее поведение",
     "На странице «Холодильник» текст на кнопках «Изменить», «Фото» и "
     "«Удалить» стоит не по центру — он прижат к левому краю, а сама кнопка "
     "шире, чем нужно. Выглядит так, будто кнопка сломана."),
    ("4. Ожидаемое поведение",
     "Текст должен стоять ровно по центру кнопки, как на остальных страницах. "
     "И кнопки лучше сделать одной ширины, чтобы список выглядел аккуратно."),
]

t = doc.add_table(rows=0, cols=2)
t.style = "Table Grid"
for name, val in example_rows:
    row = t.add_row()
    c0, c1 = row.cells
    c0.width = Cm(4.2)
    c1.width = Cm(12.0)
    r0 = c0.paragraphs[0].add_run(name)
    r0.bold = True
    r0.font.size = Pt(10.5)
    set_cell_bg(c0, "F5F1EA")
    r1 = c1.paragraphs[0].add_run(val)
    r1.font.size = Pt(10)
    r1.font.color.rgb = GREY

doc.add_paragraph()

# ── Финальный раздел ─────────────────────────────────────────────────
add_heading("В конце — пара вопросов", level=1)

add_para("Ответь коротко, это поможет понять общее впечатление:", space_after=6)
add_bullet("Что понравилось больше всего?")
add_bullet("Что было самым непонятным?")
add_bullet("Если бы можно было поменять одну вещь — какую?")

doc.add_paragraph()
add_para("Спасибо за помощь! Даже пара найденных мелочей очень ценна.",
         bold=True, color=ACCENT)

doc.save(DOC_PATH)
print(f"Готово: {DOC_PATH}")
