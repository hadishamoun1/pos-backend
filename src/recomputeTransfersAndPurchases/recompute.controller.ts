import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RecomputeCostsService } from './recompute.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePerms } from '../auth/permissions.decorator';

@Controller('recompute')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RecomputeCostsController {
  constructor(private readonly svc: RecomputeCostsService) {}

  // ✅ Start job — returns jobId immediately, no timeout
  @Post('recompute-costs')
  @RequirePerms('recompute.run')
  recompute(@Body() body: { fromDate: string }) {
    const jobId = this.svc.startRecomputeJob(body.fromDate);
    return { jobId, status: 'running' };
  }

  // ✅ Poll status (optional — frontend uses SSE stream instead)
  @Get('status/:jobId')
  @RequirePerms('recompute.run')
  getStatus(@Param('jobId') jobId: string) {
    return this.svc.getJobStatus(jobId);
  }

  // ✅ SSE stream — pushes live progress events to frontend
  @Get('progress/:jobId')
  @RequirePerms('recompute.run')
  streamProgress(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = this.svc.getJobEmitter(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const send = (data: any) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (_) {}
    };

    // Send current state immediately so the UI has something to show right away
    send({ ...job.progress, status: job.status });

    // If already finished, close immediately
    if (job.status !== 'running') {
      if (job.status === 'done') send({ ...job.progress, status: 'done', result: job.result });
      if (job.status === 'error') send({ ...job.progress, status: 'error', message: job.error });
      res.end();
      return;
    }

    const onProgress = (p: any) => send(p);
    const onDone     = () => { send({ ...job.progress, status: 'done', result: job.result }); res.end(); };
    const onError    = (err: string) => { send({ status: 'error', message: err }); res.end(); };

    job.emitter.on('progress', onProgress);
    job.emitter.once('done',   onDone);
    job.emitter.once('error',  onError);

    // Cleanup when client disconnects
    res.on('close', () => {
      job.emitter.off('progress', onProgress);
      job.emitter.off('done',     onDone);
      job.emitter.off('error',    onError);
    });
  }
}