import { render } from '@react-email/render';
import { Html, Body, Text } from '@react-email/components';

describe('react-email no build da API', () => {
  it('renderiza JSX para HTML de email', async () => {
    const html = await render(
      <Html>
        <Body>
          <Text>Olá mundo</Text>
        </Body>
      </Html>,
    );
    expect(html).toContain('Olá mundo');
    expect(html).toContain('<html');
  });

  it('renderiza a versão texto puro', async () => {
    const text = await render(
      <Html>
        <Body>
          <Text>Olá mundo</Text>
        </Body>
      </Html>,
      { plainText: true },
    );
    expect(text).toContain('Olá mundo');
    expect(text).not.toContain('<html');
  });
});
