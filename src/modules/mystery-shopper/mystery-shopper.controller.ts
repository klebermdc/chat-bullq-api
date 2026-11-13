import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { AddNumberDto } from './dto/add-number.dto';
import { AddSimulatedNumberDto } from './dto/add-simulated-number.dto';
import { SimulatorMessageDto } from './dto/simulator-message.dto';
import { ScenarioDto } from './dto/scenario.dto';
import { MysteryShopperAccess } from './mystery-shopper.access';
import { MysteryShopperService } from './mystery-shopper.service';
import { SimulatorService } from './simulated/simulator.service';

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
    private readonly simulator: SimulatorService,
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

  @Post('numbers/simulated')
  async addSimulatedNumber(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddSimulatedNumberDto,
  ) {
    await this.accessControl.assertViewer(orgId, email);
    return this.simulator.createNumber(orgId, dto, userId);
  }

  @Get('channels')
  async listChannels(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.simulator.listChannels(orgId);
  }

  @Post('simulator/:numberId/messages')
  async sendSimulated(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('email') email: string,
    @Param('numberId') numberId: string,
    @Body() dto: SimulatorMessageDto,
  ) {
    await this.accessControl.assertViewer(orgId, email);
    return this.simulator.sendMessage(orgId, numberId, dto.text);
  }

  @Get('simulator/:numberId')
  async getSimulator(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string, @Param('numberId') numberId: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.simulator.getConversation(orgId, numberId);
  }

  @Delete('numbers/:id')
  async removeNumber(@CurrentOrg('id') orgId: string, @CurrentUser('email') email: string, @Param('id') id: string) {
    await this.accessControl.assertViewer(orgId, email);
    return this.service.removeNumber(orgId, id);
  }
}
