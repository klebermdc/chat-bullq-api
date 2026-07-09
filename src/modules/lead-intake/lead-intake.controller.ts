import { Body, Controller, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { LeadIntakeService } from './lead-intake.service';
import { CreateLeadIntakeDto } from './dto/create-lead-intake.dto';

@ApiTags('Webhooks')
@Controller('webhooks/lead-intake')
export class LeadIntakeController {
  constructor(private readonly service: LeadIntakeService) {}

  @Post(':organizationId')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe lead do formulário do site (Elementor Submissions)' })
  async ingest(
    @Param('organizationId') organizationId: string,
    @Headers('x-lead-intake-secret') headerSecret: string,
    @Query('secret') querySecret: string,
    @Body() dto: CreateLeadIntakeDto,
  ) {
    await this.service.ingest(organizationId, headerSecret || querySecret, dto);
    return { ok: true };
  }
}
