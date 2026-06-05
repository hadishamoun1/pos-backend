import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PosControls } from "../entities/pos-controls.entity";

@Injectable()
export class PosControlsService implements OnModuleInit {
  constructor(
    @InjectRepository(PosControls)
    private readonly repo: Repository<PosControls>
  ) {}

  async onModuleInit() {
    const count = await this.repo.count();
    if (count === 0) {
      await this.repo.save(
        this.repo.create({ blockCreation: false, blockViewing: false })
      );
    }
  }

  async getStatus(): Promise<PosControls> {
    return this.repo.findOne({ where: { id: 1 } });
  }

  async update(
    data: Partial<Pick<PosControls, "blockCreation" | "blockViewing">>
  ): Promise<PosControls> {
    await this.repo.update(1, data);
    return this.getStatus();
  }
}
