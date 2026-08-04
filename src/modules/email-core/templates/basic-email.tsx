import {
  Html, Head, Preview, Body, Container, Heading, Text, Img, Button, Hr, Link, Section,
} from '@react-email/components';
import { BlockStyle, EmailBlock, EmailTheme, SpacerSize } from '../email-blocks.types';

interface Props {
  blocks: EmailBlock[];
  theme: EmailTheme;
  preheader?: string;
  unsubscribeUrl: string;
  /** Base pública dos ícones de redes sociais, ex. `https://api.x/api/v1/email-assets`. */
  assetsBaseUrl?: string;
}

/** `@font-face` é ignorado por Gmail e Outlook — só pilhas seguras. */
const FONT_STACKS: Record<EmailTheme['fontFamily'], string> = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

const SPACER_HEIGHTS: Record<SpacerSize, number> = { sm: 12, md: 24, lg: 48 };

const DEFAULT_BUTTON_RADIUS = 6;
const DEFAULT_BUTTON_TEXT_COLOR = '#ffffff';
const LOGO_WIDTH = 180;
const SOCIAL_ICON_SIZE = 32;

interface ResolvedTextStyle {
  color: string;
  fontSize?: number;
  fontWeight?: 'bold';
  textAlign?: 'left' | 'center' | 'right';
  paddingTop?: number;
  paddingBottom?: number;
}

/**
 * Estilo final de um bloco de texto: começa nos padrões do tema, aplica o
 * `style` do bloco por cima. Bloco sem `style` herda o tema inteiro.
 */
function resolveStyle(theme: EmailTheme, style?: BlockStyle): ResolvedTextStyle {
  return {
    color: style?.color ?? theme.textColor,
    fontSize: style?.fontSize,
    fontWeight: style?.bold ? 'bold' : undefined,
    textAlign: style?.align,
    paddingTop: style?.paddingY,
    paddingBottom: style?.paddingY,
  };
}

interface ResolvedButtonStyle {
  backgroundColor: string;
  color: string;
  borderRadius: string;
  padding: string;
  textDecoration: string;
  display: string;
}

function resolveButtonStyle(theme: EmailTheme, style?: BlockStyle): ResolvedButtonStyle {
  return {
    backgroundColor: style?.buttonColor ?? theme.primaryColor,
    color: style?.buttonTextColor ?? DEFAULT_BUTTON_TEXT_COLOR,
    borderRadius: `${style?.borderRadius ?? DEFAULT_BUTTON_RADIUS}px`,
    padding: '12px 24px',
    textDecoration: 'none',
    display: 'inline-block',
  };
}

export function BasicEmail({ blocks, theme, preheader, unsubscribeUrl, assetsBaseUrl = '' }: Props) {
  const main = { backgroundColor: theme.backgroundColor, fontFamily: FONT_STACKS[theme.fontFamily] };
  const container = {
    backgroundColor: theme.containerColor,
    margin: '0 auto',
    padding: '32px',
    maxWidth: '600px',
  };
  const footer = { color: '#71717a', fontSize: '12px', marginTop: '32px' };

  return (
    <Html lang="pt-BR">
      <Head />
      {preheader ? <Preview>{preheader}</Preview> : null}
      <Body style={main}>
        <Container style={container}>
          {blocks.map((block, i) => {
            switch (block.type) {
              case 'heading':
                return <Heading key={i} style={resolveStyle(theme, block.style)}>{block.text}</Heading>;
              case 'text':
                return <Text key={i} style={resolveStyle(theme, block.style)}>{block.text}</Text>;
              case 'image':
                return <Img key={i} src={block.src} alt={block.alt ?? ''} width="536" />;
              case 'button':
                return (
                  <Section key={i} style={{ textAlign: block.style?.align ?? 'left' }}>
                    <Button href={block.href} style={resolveButtonStyle(theme, block.style)}>
                      {block.label}
                    </Button>
                  </Section>
                );
              case 'divider':
                return <Hr key={i} />;
              case 'logo': {
                const img = <Img src={block.src} alt={block.alt ?? ''} width={LOGO_WIDTH} style={{ margin: '0 auto' }} />;
                return (
                  <Section key={i} style={{ textAlign: 'center' }}>
                    {block.href ? <Link href={block.href}>{img}</Link> : img}
                  </Section>
                );
              }
              case 'spacer':
                return <Section key={i} style={{ height: `${SPACER_HEIGHTS[block.size]}px` }} />;
              case 'offer':
                return (
                  <Section
                    key={i}
                    style={{
                      border: '1px solid #e4e4e7',
                      borderRadius: '8px',
                      padding: '20px',
                      textAlign: 'center',
                      marginBottom: '16px',
                    }}
                  >
                    {block.src ? <Img src={block.src} alt={block.title} width="536" /> : null}
                    <Heading as="h3" style={resolveStyle(theme, block.style)}>
                      {block.title}
                    </Heading>
                    {block.price ? <Text style={resolveStyle(theme, block.style)}>{block.price}</Text> : null}
                    <Button href={block.href} style={resolveButtonStyle(theme, block.style)}>
                      {block.label}
                    </Button>
                  </Section>
                );
              case 'social':
                return (
                  <Section key={i} style={{ textAlign: 'center' }}>
                    {block.links.map((link, j) => (
                      <Link key={j} href={link.href} style={{ display: 'inline-block', margin: '0 8px' }}>
                        <Img
                          src={`${assetsBaseUrl}/social/${link.network}.png`}
                          alt={link.network}
                          width={SOCIAL_ICON_SIZE}
                          height={SOCIAL_ICON_SIZE}
                        />
                      </Link>
                    ))}
                  </Section>
                );
              default:
                return null;
            }
          })}
          <Text style={footer}>
            Você recebeu este email porque está na nossa lista.{' '}
            <Link href={unsubscribeUrl}>Descadastrar</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
