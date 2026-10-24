export const CATALOG_CATEGORIES = {
    animals: ["dogsCats", "birds", "farmAnimals", "other"],
    electronics: ["phonesComputers", "homeAppliances", "tvAudio", "other"],
    furniture: ["furniture", "interiorDecor", "lighting", "other"],
    clothing: ["womenClothing", "menClothing", "shoes", "accessories", "other"],
    construction: ["bricksTools", "buildingMaterials", "renovation", "other"],
    transport: ["cars", "motorcycles", "vehicleParts", "other"],
    garden: ["plants", "gardenFurniture", "gardenTools", "other"],
    children: ["toys", "childrenClothing", "strollers", "other"],
    other: ["miscellaneous"],
} as const;

export type CatalogCategoryId = keyof typeof CATALOG_CATEGORIES;
export type CatalogSubcategoryId = (typeof CATALOG_CATEGORIES)[CatalogCategoryId][number];
export type CatalogCategoryFilter = "all" | "uncategorized" | CatalogCategoryId;

export function isCatalogCategoryId(value: unknown): value is CatalogCategoryId {
    return typeof value === "string" && Object.hasOwn(CATALOG_CATEGORIES, value);
}

export function getCatalogSubcategoryIds(category: CatalogCategoryId): readonly CatalogSubcategoryId[] {
    return CATALOG_CATEGORIES[category];
}

export function isCatalogSubcategoryId(
    category: CatalogCategoryId,
    value: unknown,
): value is CatalogSubcategoryId {
    return typeof value === "string" &&
        (CATALOG_CATEGORIES[category] as readonly string[]).includes(value);
}

export function resolveCatalogCategory(value: unknown): CatalogCategoryId | undefined {
    return isCatalogCategoryId(value) ? value : undefined;
}

export function resolveCatalogSubcategory(
    category: CatalogCategoryId | undefined,
    value: unknown,
): CatalogSubcategoryId | undefined {
    return category && isCatalogSubcategoryId(category, value) ? value : undefined;
}
