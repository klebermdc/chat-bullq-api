import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { MANAGER_ALERT_KINDS, type ManagerAlertKind } from './manager-alerts.types';

export class ManagerAlertsTestDto {
  @ApiProperty({ enum: MANAGER_ALERT_KINDS, example: 'digest' })
  @IsIn(MANAGER_ALERT_KINDS as ManagerAlertKind[])
  kind!: ManagerAlertKind;
}
