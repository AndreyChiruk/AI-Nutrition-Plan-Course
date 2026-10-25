-- Удаление таблиц, не входящих в тему курсового проекта.
--
-- Причина: тема работы — «Интернет-сервис для составления плана питания».
-- В схеме оставались таблицы, которые не относятся к планированию питания
-- и не используются приложением:
--
--   1) тренировки — модуль WorkoutPlanModule удалён из кода;
--   2) notifications — бэкенд писал туда предупреждения об аллергенах,
--      но фронтенд к этой таблице никогда не обращался: на странице
--      «Еда» предупреждение показывается баннером сразу после
--      распознавания (FoodRecognitionPage, role="alert");
--   3) семь справочников ref_* — остатки старого генератора блюд
--      (dish-catalog.builder), заменённого каталогом в products.
--
-- После этой миграции схема содержит ровно 18 таблиц, каждая из которых
-- задействована в сценариях задания.
--
-- IF EXISTS — чтобы миграция проходила и на чистой базе, где эти таблицы
-- никогда не создавались (модели из кода уже удалены).
-- CASCADE — на случай внешних ключей между удаляемыми таблицами
-- (workout_plan_days ссылается на workout_plans).

DROP TABLE IF EXISTS workout_plan_days CASCADE;
DROP TABLE IF EXISTS workout_plans CASCADE;
DROP TABLE IF EXISTS training_blocks CASCADE;

DROP TABLE IF EXISTS notifications CASCADE;

DROP TABLE IF EXISTS ref_breakfast_names CASCADE;
DROP TABLE IF EXISTS ref_dinner_names CASCADE;
DROP TABLE IF EXISTS ref_dish_modifiers CASCADE;
DROP TABLE IF EXISTS ref_grain_garnishes CASCADE;
DROP TABLE IF EXISTS ref_lunch_pairs CASCADE;
DROP TABLE IF EXISTS ref_lunch_proteins CASCADE;
DROP TABLE IF EXISTS ref_snacks CASCADE;
