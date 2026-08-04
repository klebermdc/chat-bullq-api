import { IsString, MinLength } from 'class-validator';

export class TagSubscriberDto {
  @IsString()
  @MinLength(1)
  tagId!: string;
}
