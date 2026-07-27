import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { AcceptancesService } from './acceptances.service';
import { SignAcceptanceDto } from './dto/sign-acceptance.dto';

@ApiTags('Acceptances (Public)')
@Controller('public/acceptances')
export class PublicAcceptancesController {
  constructor(private readonly service: AcceptancesService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Public()
  @Post(':token/sign')
  sign(
    @Param('token') token: string,
    @Body() dto: SignAcceptanceDto,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    return this.service.sign(token, { name: dto.name.trim(), ip, userAgent });
  }
}
