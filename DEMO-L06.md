# DEMO L06 — Eval Pipeline: покрокова інструкція для перевірки в UI

Мета: пройти наскрізний сценарій руками і закрити всі п'ять критеріїв приймання
(`HOME-TASK06.md`). Файли, на які посилається інструкція: `specs/eval-pipeline.md`,
`scripts/verify-l06.sh`.

## 0. Підготовка (5 хв)

1. `cd /Users/krasymyr.tretiak/Work/dev-digest && ./scripts/dev.sh` — підіймає Postgres,
   API (:3001) і веб (:3000). Міграції застосовуються тут же.
   Якщо кейси створювалися до появи чипа severity — один раз прогнати
   `cd server && pnpm db:backfill:eval-source` (ідемпотентно, повторний запуск нічого не робить).
2. Відкрий `http://localhost:3000` → **Settings** → впиши LLM-ключ (OpenRouter/OpenAI)
   і GitHub-токен.
   **Важливо:** прогін кейсів робить справжній виклик моделі (реплей diff через
   `reviewer-core`). Без ключа батч упаде в `provider_error`. Скоринг — окремо, він без
   моделі.
3. Додай репо → **Import PRs** → відкрий один PR (візьми справжній, не сід).

## 1. Робимо ≥8 кейсів (критерій «≥8 кейсів»)

1. На сторінці PR натисни **Review** — почекай, поки з'являться знахідки в правій панелі.
2. На кожній картці знахідки є ряд з 5 кнопок: `Accept`, `Dismiss`,
   **`Turn into eval case`**, …
3. Кнопка `Turn into eval case` **заблокована**, поки знахідка не вирішена. Ховер покаже:
   *«accept or dismiss this finding first»*. Це варто показати у відео — доказ, що тип
   очікування бере саме твоє рішення.
4. Порядок на кожній знахідці: **спершу `Accept` або `Dismiss`, потім
   `Turn into eval case`**.
   - `Accept` → створює кейс **must_find** («має знайти X у file:line»)
   - `Dismiss` → створює кейс **must_not_flag** («НЕ має коментувати Y»)
5. Зроби так, щоб було **мінімум 8 кейсів і обидва типи** — напр. 5 accepted + 3 dismissed.
   Якщо на одному PR знахідок мало — зроби Review на другому PR того ж агента.
6. Очікуєш: на кнопці з'явиться *«Added to the eval set»*. Повторний клік дасть відмову
   *«This finding is already an eval case»* — теж гарний кадр.

## 2. Дивимось набір кейсів

1. Ліве меню → **Agents** → відкрий агента, яким робив рев'ю.
2. Вкладка **Evals** (остання в стрічці: Config · Skills · Context · **Evals**).
3. Очікуєш: список кейсів, підпис `N cases in the set` (має бути ≥8), у кожного бейдж
   **MUST FIND** або **MUST NOT FLAG**, статус `never run`.
4. Внизу є рядок: *«Scoring is mechanical: a finding counts when its file matches and its
   line range overlaps an expected anchor. The scorer makes no model call.»* — прочитай його
   вголос у відео, це критерій №4 у продукті.
5. У кожного рядка ліворуч — іконка стану, у два рядки: назва + бейдж очікування, під нею
   `expected 1 finding, got N`. Праворуч — чип `Critical · security` (severity знахідки, з якої
   кейс народився), слово стану і три кнопки.

## 3. Прогін №1 (старий промпт)

1. На вкладці **Evals** натисни **Run all cases**.
2. Очікуєш: `Running — 3 of 8 cases` (прогрес живий), потім плитки
   **RECALL / PRECISION / CITATION ACCURACY / CASES PASSED** з цифрами, і статуси рядків
   `passed` / `failed`.
3. **Запиши цифри на папірець** — recall і precision першого прогону.

## 4. Змінюємо system prompt

1. Та сама сторінка агента → вкладка **Config**.
2. Зіпсуй промпт навмисно — щоб precision упав. Найнадійніше: додати в кінець щось на
   кшталт *«Flag every line you are even slightly unsure about. Report at least 15
   findings. Never stay silent.»*
   Це змусить агента шуміти → `must_not_flag`-кейси почнуть падати → **precision вниз**.
3. **Save**. Це створює нову версію агента (v2) — саме версію потім побачиш у порівнянні.

## 5. Прогін №2 (новий промпт)

1. Знов вкладка **Evals** → **Run all cases**.
2. Очікуєш: інші цифри. Precision нижче, ніж у прогоні №1 (recall може підрости — це
   нормально, агент став балакучим).

## 6. Порівняння двох прогонів (це і є скріншот для здачі)

1. Ліве меню → **Eval Dashboard**.
2. Очікуєш: таблиця **Agents** (Agent · Model · Version · Last run · Cases passed · Recall ·
   Precision · Citation) + **Recent runs** з обома прогонами + графік **Metric trend**.
3. Клікни свого агента → його сторінка `/eval/<id>`.
4. У таблиці **Recent runs** поставь чекбокси на **рівно двох** прогонах. Кнопка `Compare`
   розблокується (при одному чи трьох — тултип *«select exactly two runs»*).
5. Натисни **Compare**.
6. Очікуєш модалку: заголовок `v1 → v2`, колонки **Earlier / Later / Change** з підписаними
   дельтами (`+4pt`, `-9pt`), рядок Cost, і секцію **System prompt** — два промпти поруч.
   **Оце і є скріншот «старий промпт vs новий».**
7. Бонус для відео: кнопка **Promote version 1** — повертає агента на кращий промпт одним
   кліком.

## 7. Гейти в терміналі (критерій `pnpm verify:l06`)

```sh
cd /Users/krasymyr.tretiak/Work/dev-digest/server && pnpm verify:l06
```
Очікуєш: усі гейти `PASS`, exit code 0 (код виходу = кількість провалених гейтів).

Окремо покажи головний гейт критерію «скоринг без LLM» — він у `--core`, а не в
`--server`:
```sh
cd /Users/krasymyr.tretiak/Work/dev-digest && bash scripts/verify-l06.sh
```
Очікуєш рядок `PASS  core · the scorer makes no model call`. Він читає **імпорти**
`reviewer-core/src/eval/score.ts` і падає, якщо там з'явиться хоч щось, крім
`@devdigest/shared`. Це і є механічний доказ, що в скорингу немає жодного виклику моделі.

---

## Чек-лист здачі — куди що

| Критерій | Де показуєш |
|---|---|
| ≥8 кейсів | вкладка Evals, підпис `8 cases in the set` |
| один клік зі знахідки, обидва типи | FindingCard → `Turn into eval case`; бейджі MUST FIND / MUST NOT FLAG |
| промпт рухає recall/precision | два прогони + модалка Compare |
| скоринг без LLM | гейт `core · the scorer makes no model call` + рядок у UI |
| `pnpm verify:l06` зелений | термінал, `server/` |
| `specs/eval-pipeline.md` | вже на місці, `Status: implemented` |

## Порядок для скрінкасту (одним дублем)

знахідка → Accept → `Turn into eval case` → вкладка Evals (набір) → **Run all cases** →
метрики → Config, псуємо промпт, Save → **Run all cases** → Eval Dashboard → два чекбокси →
**Compare** → термінал `pnpm verify:l06`.
