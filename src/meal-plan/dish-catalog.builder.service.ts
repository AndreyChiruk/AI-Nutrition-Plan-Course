import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { RefBreakfastName } from '../models/RefBreakfastName';
import { RefDinnerName } from '../models/RefDinnerName';
import { RefDishModifier } from '../models/RefDishModifier';
import { RefGrainGarnish } from '../models/RefGrainGarnish';
import { RefLunchPair } from '../models/RefLunchPair';
import { RefLunchProtein } from '../models/RefLunchProtein';
import { RefSnack } from '../models/RefSnack';
import type { DishSeedRow } from './dish-catalog.types';


@Injectable()
export class DishCatalogBuilderService {
  constructor(
    @InjectModel(RefDishModifier) private readonly modifiers: typeof RefDishModifier,
    @InjectModel(RefBreakfastName) private readonly breakfastNames: typeof RefBreakfastName,
    @InjectModel(RefLunchPair) private readonly lunchPairs: typeof RefLunchPair,
    @InjectModel(RefLunchProtein) private readonly lunchProteins: typeof RefLunchProtein,
    @InjectModel(RefGrainGarnish) private readonly grainGarnishes: typeof RefGrainGarnish,
    @InjectModel(RefDinnerName) private readonly dinnerNames: typeof RefDinnerName,
    @InjectModel(RefSnack) private readonly snacks: typeof RefSnack,
  ) {}

  async buildProductSeedRows(): Promise<DishSeedRow[]> {
    const [mods, bnames, pairs, proteins, garnishes, dinners, sn] = await Promise.all([
      this.modifiers.findAll({ order: [['sortIndex', 'ASC']] }),
      this.breakfastNames.findAll({ order: [['sortIndex', 'ASC']] }),
      this.lunchPairs.findAll({ order: [['sortIndex', 'ASC']] }),
      this.lunchProteins.findAll({ order: [['sortIndex', 'ASC']] }),
      this.grainGarnishes.findAll({ order: [['sortIndex', 'ASC']] }),
      this.dinnerNames.findAll({ order: [['sortIndex', 'ASC']] }),
      this.snacks.findAll({ order: [['sortIndex', 'ASC']] }),
    ]);

    const A = mods.map((m) => m.suffix);
    if (A.length === 0) {
      throw new Error(
        'Справочник ref_dish_modifiers пуст. Выполните SQL из database/migrations/001_reference_catalog.sql или bootstrap.',
      );
    }

    const rows: DishSeedRow[] = [];

    bnames.forEach((row, i) => {
      rows.push({
        name: row.baseName + A[i % A.length],
        calories: 210 + (i % 22) * 16,
        protein: 10 + (i % 14),
        fat: 4 + (i % 10),
        carbs: 22 + (i % 32),
        allergens: i % 5 === 0 ? ['молоко'] : i % 7 === 0 ? ['глютен'] : [],
        category: 'breakfast',
      });
    });

    pairs.forEach((row, i) => {
      rows.push({
        name: `${row.proteinPart} + ${row.garnishPart}`,
        calories: 420 + (i % 20) * 16,
        protein: 28 + (i % 18),
        fat: 10 + (i % 14),
        carbs: 35 + (i % 40),
        allergens: i % 9 === 0 ? ['соя'] : i % 11 === 0 ? ['рыба'] : [],
        category: 'lunch',
      });
    });

    let idx = 0;
    for (const p of proteins) {
      for (const g of garnishes) {
        const proteinName = p.name;
        rows.push({
          name: `${proteinName} с ${g.name}`,
          calories: 380 + (idx % 32) * 14,
          protein: 24 + (idx % 18),
          fat: 10 + (idx % 16),
          carbs: 32 + (idx % 45),
          allergens:
            proteinName === 'Тофу' || proteinName === 'Фасоль'
              ? ['соя']
              : proteinName === 'Рыба запечённая'
                ? ['рыба']
                : [],
          category: 'lunch',
        });
        idx += 1;
      }
    }

    dinners.forEach((row, i) => {
      rows.push({
        name: row.name,
        calories: 300 + (i % 32) * 15,
        protein: 18 + (i % 22),
        fat: 8 + (i % 20),
        carbs: 24 + (i % 36),
        allergens:
          i % 8 === 0
            ? ['морепродукты']
            : i % 10 === 0
              ? ['глютен']
              : i % 12 === 0
                ? ['молоко']
                : [],
        category: 'dinner',
      });
    });

    sn.forEach((row, i) => {
      rows.push({
        name: row.name,
        calories: 80 + (i % 20) * 16,
        protein: 4 + (i % 14),
        fat: 2 + (i % 14),
        carbs: 8 + (i % 32),
        allergens: row.allergens ?? [],
        category: 'snack',
      });
    });

    return this.appendPortionVariants(rows);
  }

  private appendPortionVariants(base: DishSeedRow[]): DishSeedRow[] {
    const scales: Array<{ label: string; f: number }> = [
      { label: ' ·S', f: 0.8 },
      { label: ' ·L', f: 1.25 },
    ];
    const extra: DishSeedRow[] = [];
    for (const r of base) {
      for (const { label, f } of scales) {
        const full = `${r.name}${label}`.trim();
        const name = full.length > 255 ? full.slice(0, 255) : full;
        extra.push({
          ...r,
          name,
          calories: Math.max(50, Math.round(r.calories * f)),
          protein: Math.max(1, Math.round(r.protein * f)),
          fat: Math.max(0, Math.round(r.fat * f)),
          carbs: Math.max(0, Math.round(r.carbs * f)),
          allergens: [...(r.allergens ?? [])],
        });
      }
    }
    return base.concat(extra);
  }
}
