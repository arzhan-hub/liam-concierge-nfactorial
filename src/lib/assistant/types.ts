import { z } from "zod";
export const intentSchema=z.object({intent:z.enum(["packages","expected","windows","book","policy","room","aging","exceptions","unavailable"]),language:z.enum(["en","ru"])});
export type Intent=z.infer<typeof intentSchema>;
export type ParcelCard={id:string;tracking:string;carrier:string;status:string;received_at:string;location:string};
export type ExpectedCard={carrier:string;tracking:string;email_claim:string;source:string};
export type WindowCard={id:string;starts_at:string;ends_at:string;remaining_stops:number};
export type Source={id:string;title:string;version:string;page:number;text:string;score:number};
export type AssistantView={id:string;mode:"guided"|"ai";status:string;answer:string;parcels:ParcelCard[];expected:ExpectedCard[];windows:WindowCard[];sources:Source[];steps:string[];pending:boolean;operation_result?:Record<string,unknown>;result?:{parcel_id:string;window_id:string}};
