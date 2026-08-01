import { JwtAuthGuard, SuperAdminGuard } from '../../common/guards';
import { ErrorPanelController } from './error-panel.controller';

describe('ErrorPanelController', () => {
  it('exige autenticacao E superadmin na classe inteira', () => {
    const guards = Reflect.getMetadata('__guards__', ErrorPanelController);
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, SuperAdminGuard]),
    );
  });

  it('delega a listagem para o servico', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const controller = new ErrorPanelController(service as never);
    const dto = { page: 1, perPage: 25 };
    await controller.list(dto);
    expect(service.list).toHaveBeenCalledWith(dto);
  });
});
