import { IsBoolean, IsOptional } from 'class-validator';

/** Corpo opcional de POST :id/planejador. `force` só vale para OWNER/ADMIN. */
export class SyncPlanejadorDto {
  @IsOptional() @IsBoolean() force?: boolean;
}
