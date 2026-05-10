import { ObjectId } from "mongodb";
import { Column, Entity, ObjectIdColumn } from "typeorm";
import type {
  SavedAnalysisMode,
  SavedAnalysisPayload,
  SavedAnalysisVariant,
} from "../../../../application/analysis/contracts/analysis-result.repository";

@Entity("analysis_results")
export class AnalysisResultOrmEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  id: string;

  @Column()
  userId: string;

  @Column()
  repositoryId: string;

  @Column({ nullable: true })
  repositoryFullName?: string;

  @Column()
  analysisMode: SavedAnalysisMode;

  @Column()
  resultVariant: SavedAnalysisVariant;

  @Column()
  specId?: string | null;

  @Column()
  analyzedAt: Date;

  @Column()
  payload: SavedAnalysisPayload;
}
