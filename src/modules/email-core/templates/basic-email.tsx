import {
  Html, Head, Preview, Body, Container, Heading, Text, Img, Button, Hr, Link, Section,
} from '@react-email/components';
import { EmailBlock } from '../email-blocks.types';

interface Props {
  blocks: EmailBlock[];
  preheader?: string;
  unsubscribeUrl: string;
}

const main = { backgroundColor: '#f4f4f5', fontFamily: 'Arial, Helvetica, sans-serif' };
const container = { backgroundColor: '#ffffff', margin: '0 auto', padding: '32px', maxWidth: '600px' };
const buttonStyle = {
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  textDecoration: 'none',
  display: 'inline-block',
};
const footer = { color: '#71717a', fontSize: '12px', marginTop: '32px' };

export function BasicEmail({ blocks, preheader, unsubscribeUrl }: Props) {
  return (
    <Html lang="pt-BR">
      <Head />
      {preheader ? <Preview>{preheader}</Preview> : null}
      <Body style={main}>
        <Container style={container}>
          {blocks.map((block, i) => {
            switch (block.type) {
              case 'heading':
                return <Heading key={i}>{block.text}</Heading>;
              case 'text':
                return <Text key={i}>{block.text}</Text>;
              case 'image':
                return <Img key={i} src={block.src} alt={block.alt ?? ''} width="536" />;
              case 'button':
                return (
                  <Section key={i}>
                    <Button href={block.href} style={buttonStyle}>
                      {block.label}
                    </Button>
                  </Section>
                );
              case 'divider':
                return <Hr key={i} />;
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
