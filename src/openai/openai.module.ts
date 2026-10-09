import { Module } from '@nestjs/common';
import { OpenAiService } from './openai.service';
import { OpenAiUsageService } from './openai-usage.service';

@Module({
  providers: [OpenAiService, OpenAiUsageService],
  exports: [OpenAiService, OpenAiUsageService],
})
export class OpenAiModule {}
