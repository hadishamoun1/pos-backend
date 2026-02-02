// src/employees/employees.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { EmployeesService } from './Employee.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  /**
   * Create a new employee
   * POST /employees
   */
  @Post()
  create(@Body() createEmployeeDto: any) {
    return this.employeesService.create(createEmployeeDto);
  }

  /**
   * Upload files for an employee
   * POST /employees/:id/upload
   */
  @Post(':id/upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: './uploads/employees',
        filename: (req, file, cb) => {
          // Generate unique filename: timestamp-random-originalname
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          const basename = file.originalname.replace(ext, '').replace(/[^a-zA-Z0-9]/g, '_');
          const filename = `${basename}-${uniqueSuffix}${ext}`;
          cb(null, filename);
        },
      }),
      fileFilter: (req, file, cb) => {
        // Allow only specific file types
        if (file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)) {
          cb(null, true);
        } else {
          cb(new Error('Only PDF, JPG, and PNG files are allowed!'), false);
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max per file
      },
    }),
  )
  async uploadFiles(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    return this.employeesService.addFiles(id, files);
  }

  /**
   * Get all employees with optional filters
   * GET /employees
   * GET /employees?status=expiring
   * GET /employees?search=ahmed
   */
  @Get()
  async findAll(
    @Query('status') status?: 'valid' | 'expiring' | 'expired',
    @Query('search') search?: string,
  ) {
    // If search query provided
    if (search) {
      return this.employeesService.search(search);
    }

    // If status filter provided
    if (status) {
      return this.employeesService.findByStatus(status);
    }

    // Otherwise, return all
    return this.employeesService.findAll();
  }

  /**
   * Get alerts for expiring/expired documents
   * GET /employees/alerts
   */
  @Get('alerts')
  getAlerts() {
    return this.employeesService.getAlerts();
  }

  /**
   * Get one employee by ID
   * GET /employees/:id
   */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.findOne(id);
  }

  /**
   * Update an employee
   * PATCH /employees/:id
   */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateEmployeeDto: any,
  ) {
    return this.employeesService.update(id, updateEmployeeDto);
  }

  /**
   * Delete an employee
   * DELETE /employees/:id
   */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.remove(id);
  }

  /**
   * Delete a file from an employee
   * DELETE /employees/:id/files/:fileName
   */
  @Delete(':id/files/:fileName')
  deleteFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileName') fileName: string,
  ) {
    return this.employeesService.deleteFile(id, fileName);
  }
}