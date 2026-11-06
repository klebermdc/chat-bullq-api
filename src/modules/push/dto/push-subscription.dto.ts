import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

const MAX_ENDPOINT = 2048;
const MAX_KEY = 256;
const MAX_UA = 512;

export class PushKeysDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_KEY)
  p256dh!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_KEY)
  auth!: string;
}

/** O formato do `PushSubscription.toJSON()` do navegador. */
export class PushSubscriptionDto {
  @ApiProperty({ example: 'https://fcm.googleapis.com/fcm/send/…' })
  @IsString()
  @MaxLength(MAX_ENDPOINT)
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_UA)
  userAgent?: string;
}
