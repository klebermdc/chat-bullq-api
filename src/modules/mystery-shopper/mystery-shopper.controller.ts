import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { AddNumberDto } from './dto/add-number.dto';
import { ScenarioDto } from './dto/scenario.dto';
import { MysteryShopperAccess } from './mystery-shopper.access';
import { MysteryShopperService } from './mystery-shopper.service';

/**
 * Cliente oculto. Fora do Swagger e com 404 para quem não está em
 * `settings.mysteryShopper.viewerEmails` — inclusive ADMIN/OWNER.
 */
@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('mystery-shopper')
export class MysteryShopperController {
  constructor(
    private readonly service: MysteryShopperService,
    private readonly accessControl: MysteryShopperAccess,
  ) {}

  /** Única rota que responde a todos: diz só se o menu aparece. */
  @Get('access')
  async access(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string) {
    return { allowed: await this.accessControl.isAllowed(orgId, email) };
  }

  @Get('visits')
  async listVisits(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.listVisits(orgId);
  }

  @Get('visits/:id')
  async getVisit(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string, @Param('id') id: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.getVisit(orgId, id);
  }

  @Patch('visits/:id')
  async updateScenario(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('email') email: string,
    @Param('id') id: string,
    @Body() dto: ScenarioDto,
  ) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.updateScenario(orgId, id, dto.scenario);
  }

  @Post('visits/:id/evaluate')
  async evaluate(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string, @Param('id') id: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.requestEvaluation(orgId, id);
  }

  @Post('visits/:id/discard')
  async discard(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string, @Param('id') id: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.discard(orgId, id);
  }

  @Get('ranking')
  async ranking(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.ranking(orgId);
  }

  @Get('numbers')
  async listNumbers(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.listNumbers(orgId);
  }

  @Post('numbers')
  async addNumber(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddNumberDto,
  ) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.addNumber(orgId, dto.phone, dto.label, userId);
  }

  @Delete('numbers/:id')
  async removeNumber(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string, @Param('id') id: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.removeNumber(orgId, id);
  }
}
