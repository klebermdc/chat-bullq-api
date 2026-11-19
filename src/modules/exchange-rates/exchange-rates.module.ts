import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesCron } from './exchange-rates.cron';
import { EXCHANGE_RATES_QUEUE, ExchangeRatesProcessor } from './exchange-rates.processor';
import { ExchangeRatesService } from './exchange-rates.service';

/**
 * Câmbio do dólar nas operadoras (JT, SC automáticos; AZ só link).
 * Aparece para a org com `settings.operatorExchangeRates = true`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: EXCHANGE_RATES_QUEUE })],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService, ExchangeRatesProcessor, ExchangeRatesCron],
})
export class ExchangeRatesModule {}
