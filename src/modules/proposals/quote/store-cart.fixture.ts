/**
 * Texto REAL do carrinho da loja (Just Travel / reservas.orlandofastpass.com.br),
 * como o Playwright devolve em `innerText('body')` — capturado em 12/11/2026,
 * a partir de "Detalhes do pedido". Base dos testes do leitor do carrinho.
 */
export const STORE_CART_TEXT = `BLACK TRAVEL
Cotação do dólar: R$ 5,78 = US$ 1
BRL
Meu carrinho
4
Login ou cadastro
Preço atualizado a cada 25 minutos. Garanta já seus produtos com o preço atual.
24:56
Detalhes do pedido
Ingressos
R$ 5.888,19
UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]
Pessoas
1 Adulto
Data
20/12/2026
R$ 1.118,83
PIX ou boleto
em 10x R$ 1.183,98
UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]
Pessoas
1 Adulto
Data
20/12/2026
R$ 1.118,83
PIX ou boleto
em 10x R$ 1.183,98
UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]
Pessoas
1 Adulto
Data
20/12/2026
R$ 1.118,83
PIX ou boleto
em 10x R$ 1.183,98
WALT DISNEY WORLD - BASE TICKETS [02 dias]
Pessoas
Pessoas
1 Adultos, 0 Crianças
1 Adulto
Data
20/12/2026
Janela de uso
Utilização válida de 20/12/2026 até 23/12/2026
R$ 2.531,70
PIX ou boleto
em 10x R$ 2.637,18
Subtotal no pix ou boleto
R$ 5.888,19
Subtotal de Ingressos em 10x
R$ 6.189,12
Melhor Oferta (4,86% OFF)
Desconto especial para pagamento à vista!
Você está economizando
(em relação a 10x no cartão)
- R$ 300,93
Total do pedido
R$ 5.888,19
em 10x R$ 6.189,12
Meio de pagamento
Pix`;

/**
 * A página INTEIRA do mesmo carrinho, como o `RenderService.renderWhenText`
 * devolve no estado final (Chrome headless, 12/11/2026): formulário de
 * contato antes, espaço não separável ("1\u00a0Adulto"), linhas só com espaço
 * e os itens em outra ordem (Universal primeiro).
 */
export const STORE_PAGE_TEXT_HEADLESS = `BLACK TRAVEL
Cotação do dólar: R$ 5,78 = US$ 1
BRL
Meu carrinho
4
Login ou cadastro
Preço atualizado a cada 25 minutos. Garanta já seus produtos com o preço atual.
00:00
1
Dados de Contato

Vamos usar estas informações para enviar a confirmação e as novidades sobre sua reserva

Já tem uma conta?
Faça o login

Informações Pessoais

E-mail
Nome
Sobrenome
Nacionalidade
Brazil

CPF

Telefone

Endereço

País
Brazil
CEP
Cidade
Estado
Logradouro
Bairro
Número
Complemento

Criação de Senha

Senha
Confirme sua senha
Receba e-mail com ofertas especiais, inspirações, dicas e outras novidades.
Li e aceito os Termos e Condições e Política de Privacidade
Prosseguir
2
Dados dos viajantes
3
Proteção para imprevistos
4
Dados de Pagamento
Detalhes do pedido
Ingressos
R$ 5.888,19

UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]

Pessoas
 

1 Adulto

Data
 

20/12/2026

R$ 1.118,83

PIX ou boleto
em 10x R$ 1.183,98

UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]

Pessoas
 

1 Adulto

Data
 

20/12/2026

R$ 1.118,83

PIX ou boleto
em 10x R$ 1.183,98

UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]

Pessoas
 

1 Adulto

Data
 

20/12/2026

R$ 1.118,83

PIX ou boleto
em 10x R$ 1.183,98

WALT DISNEY WORLD - BASE TICKETS [02 dias]

Pessoas
Pessoas
1 Adultos, 0 Crianças
 

1 Adulto

Data
 

20/12/2026

Janela de uso
Utilização válida de 20/12/2026 até 23/12/2026

R$ 2.531,70

PIX ou boleto
em 10x R$ 2.637,18

Subtotal no pix ou boleto

R$ 5.888,19

Subtotal de Ingressos em 10x

R$ 6.189,12

Melhor Oferta (4,86% OFF)

Desconto especial para pagamento à vista!

Você está economizando

(em relação a 10x no cartão)

- R$ 300,93

Total do pedido

R$ 5.888,19

em 10x R$ 6.189,12

Meio de pagamento
Pix
4,86%
OFF
Cartão de Credito

Possui cupom de desconto?

Aplicar

Conheça

Faça login

Cadastre-se

Viaje

Ingressos

Carros

Hospedagens

Seguros

Termos e Políticas

Políticas e Termos

Política de privacidade

Política de cancelamento

Whatsapp: +55 11 5198 4190

Televendas: +55 11 5198 4190

- Todos os direitos reservados`;

/**
 * A mesma página num estado INTERMEDIÁRIO (ainda com "Estamos carregando os
 * dados do carrinho"): já tem preços e "Total do pedido ... em 10x", mas falta
 * a "Janela de uso" da Disney e o subtotal é "Subtotal Ingressos". Não pode
 * ser lida — o render espera passar deste estado.
 */
export const STORE_PAGE_TEXT_LOADING = `BLACK TRAVEL
Cotação do dólar: R$ 5,78 = US$ 1
BRL
Meu carrinho
4
Login ou cadastro
1
Dados de Contato

Vamos usar estas informações para enviar a confirmação e as novidades sobre sua reserva

Já tem uma conta?
Faça o login

Informações Pessoais

E-mail
Nome
Sobrenome
Nacionalidade
Brazil

CPF

Telefone

Endereço

País
Brazil
CEP
Cidade
Estado
Logradouro
Bairro
Número
Complemento

Criação de Senha

Senha
Confirme sua senha
Receba e-mail com ofertas especiais, inspirações, dicas e outras novidades.
Li e aceito os Termos e Condições e Política de Privacidade
Prosseguir
2
Dados dos viajantes
3
Dados de Pagamento
Detalhes do pedido

Estamos carregando os dados do carrinho.

Ingressos
R$ 6.189,12
WALT DISNEY WORLD - BASE TICKETS [02 dias]
Pessoas
 
1 Adulto
Data
 
20/12/2026
R$ 2.531,70
PIX ou boleto
em 10x R$ 2.637,18
UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]
Pessoas
 
1 Adulto
Data
 
20/12/2026
R$ 1.118,83
PIX ou boleto
em 10x R$ 1.183,98
UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]
Pessoas
 
1 Adulto
Data
 
20/12/2026
R$ 1.118,83
PIX ou boleto
em 10x R$ 1.183,98
UNIVERSAL ORLANDO RESORT - UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]
Pessoas
 
1 Adulto
Data
 
20/12/2026
R$ 1.118,83
PIX ou boleto
em 10x R$ 1.183,98

Subtotal Ingressos

R$ 6.189,12
Melhor Oferta (4,86% OFF)
Desconto especial para pagamento à vista!
Você está economizando
(em relação a 10x no cartão)
- R$ 300,93
 Melhor Oferta (4,86% OFF)

Total do pedido

R$ 5.888,19

em 10x R$ 6.189,12

Meio de pagamento
Pix
4,86%
OFF
Cartão de Credito

Possui cupom de desconto?

Aplicar

Conheça

Faça login

Cadastre-se

Viaje

Ingressos

Carros

Hospedagens

Seguros

Termos e Políticas

Políticas e Termos

Política de privacidade

Política de cancelamento

Whatsapp: +55 11 5198 4190

Televendas: +55 11 5198 4190

- Todos os direitos reservados`;

/** O que vem antes do carrinho na página inteira: o formulário de contato. */
export const STORE_CONTACT_FORM_TEXT = `Dados de Contato
Nome
E-mail
CPF
Telefone
Pessoas
3 Adultos
Data
01/01/2027
em 10x R$ 99,00`;
