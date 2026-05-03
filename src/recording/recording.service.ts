import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { RecordingDevice } from '../entities/recording-device.entity';
import { Recording } from '../entities/recording.entity';

@Injectable()
export class RecordingService {
  readonly uploadDir = path.join(process.cwd(), 'uploads', 'recordings');

  constructor(
    @InjectRepository(RecordingDevice) private deviceRepo: Repository<RecordingDevice>,
    @InjectRepository(Recording) private recordingRepo: Repository<Recording>,
  ) {
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  private checkSecret(secret: string) {
    const expected = (process.env.RECORDING_SECRET || 'rec-secret-change-me').trim();
    if (secret !== expected) throw new ForbiddenException('Invalid recording secret');
  }

  async register(pcId: string, pcName: string, secret: string) {
    this.checkSecret(secret);
    let device = await this.deviceRepo.findOne({ where: { pcId } });
    if (!device) {
      device = this.deviceRepo.create({ pcId, pcName, command: 'idle', status: 'idle' });
    } else {
      device.pcName = pcName;
    }
    device.lastSeen = new Date();
    await this.deviceRepo.save(device);
    return { success: true, command: device.command };
  }

  async poll(pcId: string, secret: string) {
    this.checkSecret(secret);
    const device = await this.deviceRepo.findOne({ where: { pcId } });
    if (!device) throw new NotFoundException('Device not registered');
    device.lastSeen = new Date();
    device.status = ['recording', 'audio_only'].includes(device.command) ? device.command : 'idle';
    await this.deviceRepo.save(device);
    return { command: device.command };
  }

  async sendCommand(pcId: string, command: 'recording' | 'idle' | 'audio_only') {
    const device = await this.deviceRepo.findOne({ where: { pcId } });
    if (!device) throw new NotFoundException('Device not found');
    device.command = command;
    await this.deviceRepo.save(device);
    return { success: true, pcId, command };
  }

  async listDevices() {
    const devices = await this.deviceRepo.find({ order: { lastSeen: 'DESC' } });
    const now = Date.now();
    return devices.map((d) => ({
      ...d,
      online: d.lastSeen ? now - new Date(d.lastSeen).getTime() < 15000 : false,
    }));
  }

  async saveRecording(pcId: string, secret: string, file: Express.Multer.File) {
    this.checkSecret(secret);
    const device = await this.deviceRepo.findOne({ where: { pcId } });
    if (!device) throw new NotFoundException('Device not registered');
    const recording = this.recordingRepo.create({
      pcId,
      pcName: device.pcName,
      filename: file.filename,
      fileSize: file.size,
      recordedAt: new Date(),
    });
    await this.recordingRepo.save(recording);
    return { success: true, id: recording.id };
  }

  async listRecordings(pcId?: string) {
    const where: any = pcId ? { pcId } : {};
    return this.recordingRepo.find({ where, order: { recordedAt: 'DESC' }, take: 500 });
  }

  getFilePath(filename: string) {
    // Prevent path traversal
    const safe = path.basename(filename);
    return path.join(this.uploadDir, safe);
  }

  async deleteRecording(id: number) {
    const rec = await this.recordingRepo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Recording not found');
    const filePath = this.getFilePath(rec.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await this.recordingRepo.remove(rec);
    return { success: true };
  }
}
