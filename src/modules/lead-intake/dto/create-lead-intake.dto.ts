import { IsOptional, IsString } from 'class-validator';

export class CreateLeadIntakeDto {
  @IsString()
  phone!: string;

  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() formName?: string;
  @IsOptional() @IsString() utmSource?: string;
  @IsOptional() @IsString() utmMedium?: string;
  @IsOptional() @IsString() utmCampaign?: string;
}
