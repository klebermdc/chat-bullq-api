/** Para `@ValidateIf`: campo ausente pula a validação; null não pula (e falha). */
export const present = (_: object, v: unknown) => v !== undefined;
