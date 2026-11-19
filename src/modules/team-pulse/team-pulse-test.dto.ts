import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PULSE_KINDS, type PulseKind } from './team-pulse.rules';

export class TeamPulseTestDto {
  @ApiProperty({ enum: PULSE_KINDS, example: 'hourly' })
  @IsIn(PULSE_KINDS as PulseKind[])
  kind!: PulseKind;
}
